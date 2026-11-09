import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { z } from "zod";
import { AuditService } from "../core/audit.service";
import { CurrentScope, Requires } from "../core/auth";
import { addDays, dbDate, diffDays, istDate, ymd } from "../core/dates";
import { branchWhere, Db, Scope, Tx } from "../core/db.service";
import { notFound, unprocessable } from "../core/errors";
import type { Permission } from "../core/permissions";
import { Zod, zDate } from "../core/validation";
import { BillingService } from "./billing.service";
import { serialiseSub } from "./members.controller";

type S = Scope & { permission: Permission };

const freezeBody = z.object({ startDate: zDate, endDate: zDate, reason: z.string().trim().max(300).optional() });

interface FreezeRow { startDate: Date; endDate: Date; endedEarlyOn: Date | null }

/** Days a freeze actually used (an early end on day N means days before N were frozen). */
export function usedDays(f: FreezeRow): number {
  const start = ymd(f.startDate);
  const end = f.endedEarlyOn ? addDays(ymd(f.endedEarlyOn), -1) : ymd(f.endDate);
  return Math.max(0, diffDays(start, end) + 1);
}

/** Freeze allowance for a subscription, from the plan terms it was sold under. */
export function freezeAllowance(sub: { planSnapshot: unknown; plan?: { freezeAllowed: boolean; maxFreezeDays: number; maxFreezeCount: number } | null; freezes: FreezeRow[] }) {
  const snap = (sub.planSnapshot ?? {}) as Record<string, any>;
  const allowed: boolean = snap.freezeAllowed ?? sub.plan?.freezeAllowed ?? false;
  const maxDays: number = snap.maxFreezeDays ?? sub.plan?.maxFreezeDays ?? 0;
  const maxCount: number = snap.maxFreezeCount ?? sub.plan?.maxFreezeCount ?? 0;
  const used = sub.freezes.map(usedDays).filter((d) => d > 0);
  const daysUsed = used.reduce((a, b) => a + b, 0);
  return { allowed, maxDays, maxCount, daysUsed, timesUsed: used.length, daysLeft: Math.max(0, maxDays - daysUsed), timesLeft: Math.max(0, maxCount - used.length) };
}

@Controller("subscriptions")
export class FreezeController {
  constructor(private readonly db: Db, private readonly audit: AuditService, private readonly billing: BillingService) {}

  private async load(tx: Tx, scope: S, id: string) {
    const sub = await tx.subscription.findFirst({
      where: { id, member: { deletedAt: null, ...branchWhere(scope.branchIds, "homeBranchId") } },
      include: { freezes: { orderBy: { startDate: "asc" } }, plan: true, member: { select: { homeBranchId: true } } },
    });
    if (!sub) throw notFound("Membership");
    return sub;
  }

  /** Moves later booked memberships (renewals) by `days`, in an order that never makes two overlap. */
  private async shiftLater(tx: Tx, memberId: string, afterYmd: string, days: number) {
    const later = await tx.subscription.findMany({
      where: { memberId, status: { in: ["SCHEDULED", "PENDING_PAYMENT"] }, startDate: { gt: dbDate(afterYmd) } },
      orderBy: { startDate: days > 0 ? "desc" : "asc" },
    });
    for (const s of later) {
      await tx.subscription.update({
        where: { id: s.id },
        data: { startDate: dbDate(addDays(ymd(s.startDate), days)), endDate: dbDate(addDays(ymd(s.endDate), days)) },
      });
    }
    return later.length;
  }

  @Post(":id/freeze")
  @HttpCode(200)
  @Requires("subscriptions.freeze")
  freeze(@CurrentScope() scope: S, @Param("id", ParseUUIDPipe) id: string, @Body(new Zod(freezeBody)) body: z.infer<typeof freezeBody>) {
    return this.db.run(scope, async (tx) => {
      const sub = await this.load(tx, scope, id);
      const today = istDate();
      if (sub.status !== "ACTIVE" && sub.status !== "FROZEN") throw unprocessable("NOT_ACTIVE", "Only a current membership can be frozen");
      const a = freezeAllowance(sub);
      if (!a.allowed) throw unprocessable("FREEZE_NOT_ALLOWED", "This plan can't be frozen");
      if (body.startDate < today) throw unprocessable("START_IN_PAST", "A freeze can't start in the past");
      if (body.endDate < body.startDate) throw unprocessable("BAD_DATES", "The freeze must end on or after it starts");
      if (body.startDate > ymd(sub.endDate)) throw unprocessable("AFTER_END", "The freeze must start before the membership ends");
      const days = diffDays(body.startDate, body.endDate) + 1;
      if (a.timesLeft < 1) throw unprocessable("FREEZE_LIMIT", `This plan allows ${a.maxCount} freeze${a.maxCount === 1 ? "" : "s"}, already used`);
      if (days > a.daysLeft) throw unprocessable("FREEZE_LIMIT", `Only ${a.daysLeft} freeze day${a.daysLeft === 1 ? "" : "s"} left on this plan`);
      const clash = sub.freezes.find((f) => usedDays(f) > 0 && ymd(f.startDate) <= body.endDate && (f.endedEarlyOn ? addDays(ymd(f.endedEarlyOn), -1) : ymd(f.endDate)) >= body.startDate);
      if (clash) throw unprocessable("FREEZE_OVERLAP", "There's already a freeze on those dates");

      const oldEnd = ymd(sub.endDate);
      await this.shiftLater(tx, sub.memberId, oldEnd, days);
      const freeze = await tx.subscriptionFreeze.create({
        data: { subscriptionId: id, startDate: dbDate(body.startDate), endDate: dbDate(body.endDate), reason: body.reason, approvedById: scope.userId },
      });
      const updated = await tx.subscription.update({
        where: { id },
        data: { endDate: dbDate(addDays(oldEnd, days)), ...(body.startDate === today ? { status: "FROZEN" } : {}) },
        include: { plan: { select: { name: true } } },
      });
      await this.billing.refreshMemberStatus(tx, sub.memberId);
      await this.audit.log(tx, {
        userId: scope.userId, branchId: sub.member.homeBranchId, action: "subscription.freeze", entityType: "Subscription", entityId: id,
        before: { endDate: oldEnd }, after: { endDate: ymd(updated.endDate), freezeId: freeze.id, startDate: body.startDate, freezeEnd: body.endDate, days },
      });
      return serialiseSub(updated);
    });
  }

  /** Ends the current freeze today, or cancels a future one. Unused days go back to the member. */
  @Post(":id/unfreeze")
  @HttpCode(200)
  @Requires("subscriptions.freeze")
  unfreeze(@CurrentScope() scope: S, @Param("id", ParseUUIDPipe) id: string) {
    return this.db.run(scope, async (tx) => {
      const sub = await this.load(tx, scope, id);
      const today = istDate();
      const f = sub.freezes.find((x) => !x.endedEarlyOn && ymd(x.endDate) >= today);
      if (!f) throw unprocessable("NOT_FROZEN", "There's no current or upcoming freeze to end");
      const fStart = ymd(f.startDate);
      const endsOn = fStart > today ? fStart : today; // future freeze is cancelled entirely
      const giveBack = diffDays(endsOn, ymd(f.endDate)) + 1;
      const oldEnd = ymd(sub.endDate);
      await tx.subscriptionFreeze.update({ where: { id: f.id }, data: { endedEarlyOn: dbDate(endsOn) } });
      const updated = await tx.subscription.update({
        where: { id },
        data: { endDate: dbDate(addDays(oldEnd, -giveBack)), ...(sub.status === "FROZEN" ? { status: "ACTIVE" } : {}) },
        include: { plan: { select: { name: true } } },
      });
      await this.shiftLater(tx, sub.memberId, oldEnd, -giveBack);
      await this.billing.refreshMemberStatus(tx, sub.memberId);
      await this.audit.log(tx, {
        userId: scope.userId, branchId: sub.member.homeBranchId, action: "subscription.unfreeze", entityType: "Subscription", entityId: id,
        before: { endDate: oldEnd, status: sub.status }, after: { endDate: ymd(updated.endDate), status: updated.status, daysReturned: giveBack },
      });
      return serialiseSub(updated);
    });
  }
}
