import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { AuditService } from "../core/audit.service";
import { AuthContext, CurrentAuth, CurrentScope, Requires } from "../core/auth";
import { addDays, dbDate, diffDays, istDate, istDayStart, ymd } from "../core/dates";
import { branchWhere, Db, inScope, Scope } from "../core/db.service";
import { forbidden, notFound, unprocessable } from "../core/errors";
import { Idempotency } from "../core/idempotency.service";
import type { Permission } from "../core/permissions";
import { normalisePhone, Zod, zDate, zUuid } from "../core/validation";
import type { Prisma } from "../generated/prisma/client";
import { duesByMember } from "./members.controller";
import { SettingsService } from "../core/settings.service";

type S = Scope & { permission: Permission };

/** A repeat scan within this many hours of an open check-in is treated as "already inside". */
const INSIDE_HOURS = 4;

const checkInBody = z.object({
  method: z.enum(["AUTO", "QR", "MEMBER_CODE", "PHONE_LOOKUP", "RFID", "MANUAL"]).default("AUTO"),
  credential: z.string().trim().min(3).max(200),
  branchId: zUuid.optional(),
});

const listQ = z.object({
  date: zDate.optional(),
  branchId: zUuid.optional(),
  memberId: zUuid.optional(),
  result: z.enum(["ALLOWED", "DENIED"]).optional(),
  inside: z.enum(["true", "false"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

const DENY_MESSAGE: Record<string, string> = {
  NOT_FOUND: "No member found. Check the code or search by phone.",
  NO_ACTIVE_SUBSCRIPTION: "No active membership. Please renew at the desk.",
  SUBSCRIPTION_FROZEN: "Membership is frozen. Unfreeze it at the desk to train today.",
  BRANCH_NOT_ALLOWED: "This membership isn't valid at this branch.",
  OUTSIDE_ACCESS_HOURS: "This plan doesn't allow entry at this time.",
  RESTRICTION_FLAG: "Please see the front desk before entering.",
};

const hhmmIst = (d = new Date()) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);

function detectMethod(credential: string): "QR" | "MEMBER_CODE" | "PHONE_LOOKUP" | "RFID" {
  const c = credential.trim();
  if (/^[A-Z0-9]+(-[A-Z0-9]+)*-\d{4,}$/i.test(c)) return "MEMBER_CODE";
  if (/^[+\d][\d\s-]{8,}$/.test(c) && c.replace(/\D/g, "").length >= 10) return "PHONE_LOOKUP";
  if (c.length >= 20) return "QR";
  return "RFID";
}

const firstName = (m: { firstName: string }) => m.firstName;

@Controller()
export class AttendanceController {
  constructor(private readonly db: Db, private readonly audit: AuditService, private readonly idem: Idempotency, private readonly settings: SettingsService) {}

  /**
   * Front-desk check-in. Every decision is made here, never in the browser, and every attempt is stored.
   * Members can be multi-branch, so the member/subscription lookup runs business-wide (read-only, minimal
   * fields); the attendance row itself is written under the staff member's own branch scope.
   */
  @Post("attendance/check-in")
  @HttpCode(200)
  @Requires("attendance.checkin")
  checkIn(@CurrentScope() scope: S, @CurrentAuth() auth: AuthContext, @Headers("idempotency-key") key: string | undefined, @Body(new Zod(checkInBody)) body: z.infer<typeof checkInBody>) {
    const branchId = body.branchId ?? (scope.branchIds !== "*" && scope.branchIds.length === 1 ? scope.branchIds[0] : undefined);
    if (!branchId) throw unprocessable("BRANCH_REQUIRED", "Choose which branch you're checking people into");
    if (!inScope(scope.branchIds, branchId)) throw forbidden("You can't check people in at that branch");
    const method = body.method === "AUTO" ? detectMethod(body.credential) : body.method;

    return this.idem.run(scope.userId, key, "POST /attendance/check-in", body, async () => {
      const graceDays = (await this.settings.get())["checkin.graceDays"];
      // 1. Find the member (business-wide, read-only).
      const lookup = await this.db.run({ userId: scope.userId, branchIds: "*" }, async (tx) => {
        const c = body.credential.trim();
        const where: Prisma.MemberWhereInput =
          method === "QR" ? { qrToken: c } :
          method === "MEMBER_CODE" || method === "MANUAL" ? { memberCode: c.toUpperCase() } :
          method === "PHONE_LOOKUP" ? { phone: normalisePhone(c) } :
          { rfidTag: c };
        const members = await tx.member.findMany({ where: { ...where, deletedAt: null }, take: 6, include: { homeBranch: { select: { name: true } } } });
        if (members.length !== 1) return { members };
        const m = members[0];
        const today = istDate();
        const subs = await tx.subscription.findMany({
          where: { memberId: m.id, OR: [{ status: { in: ["ACTIVE", "FROZEN", "SCHEDULED", "PENDING_PAYMENT"] } }, { status: "EXPIRED", endDate: { gte: dbDate(addDays(today, -graceDays)) } }] },
          include: { plan: { include: { branches: true } } },
          orderBy: { endDate: "desc" },
        });
        const dues = (await duesByMember(tx, [m.id])).get(m.id) ?? 0;
        const hours = await tx.branchHours.findMany({ where: { branchId, dayOfWeek: dbDate(today).getUTCDay() } });
        return { members, m, subs, dues, hours, today };
      });

      if (lookup.members.length > 1) {
        // Shared family phone: let the desk pick the right person.
        return {
          result: "CHOOSE" as const,
          message: "More than one member uses this phone number. Pick the right person.",
          candidates: lookup.members.map((m) => ({ memberCode: m.memberCode, name: [m.firstName, m.lastName].filter(Boolean).join(" "), branch: m.homeBranch.name })),
        };
      }

      return this.db.run(scope, async (tx) => {
        const record = async (result: "ALLOWED" | "DENIED", denyReason: string | null, memberId: string | null, subscriptionId: string | null) =>
          tx.attendance.create({
            data: {
              memberId, branchId, operatorId: auth.userId, subscriptionId, method, result,
              denyReason: denyReason as any, checkInAt: new Date(),
            },
          });

        if (!("m" in lookup) || !lookup.m) {
          const a = await record("DENIED", "NOT_FOUND", null, null);
          return { attendanceId: a.id, result: "DENIED" as const, denyReason: "NOT_FOUND", message: DENY_MESSAGE.NOT_FOUND };
        }
        const { m, subs, dues, hours, today } = lookup;
        const card = (sub?: (typeof subs)[number]) => ({
          memberId: m.id, memberCode: m.memberCode, firstName: firstName(m), fullName: [m.firstName, m.lastName].filter(Boolean).join(" "),
          homeBranch: m.homeBranch.name, planName: sub?.plan.name ?? null, validUntil: sub ? ymd(sub.endDate) : null,
          daysRemaining: sub ? diffDays(today, ymd(sub.endDate)) + 1 : null, duesPaise: dues,
        });

        // Already inside? Don't create a second visit for a double scan.
        const open = await tx.attendance.findFirst({
          where: { memberId: m.id, result: "ALLOWED", checkOutAt: null, checkInAt: { gte: new Date(Date.now() - INSIDE_HOURS * 3600_000) } },
          orderBy: { checkInAt: "desc" },
        });
        let current = subs.find((s) => s.status === "ACTIVE" && ymd(s.startDate) <= today && ymd(s.endDate) >= today);
        // Grace period: a just-expired member can still train for a few days (business rule).
        const inGrace = !current && graceDays > 0 ? subs.find((s) => (s.status === "EXPIRED" || s.status === "ACTIVE") && ymd(s.endDate) < today && ymd(s.endDate) >= addDays(today, -graceDays)) : undefined;
        if (inGrace) current = inGrace;
        if (open) {
          return { attendanceId: open.id, result: "ALLOWED" as const, alreadyInside: true, message: `${firstName(m)} is already checked in.`, member: card(current) };
        }

        let deny: string | null = null;
        let sub = current;
        if (m.hasAccessRestriction) deny = "RESTRICTION_FLAG";
        else if (!current) {
          const frozen = subs.find((s) => s.status === "FROZEN");
          deny = frozen ? "SUBSCRIPTION_FROZEN" : "NO_ACTIVE_SUBSCRIPTION";
          sub = frozen ?? subs.find((s) => s.status === "PENDING_PAYMENT");
        } else {
          const snap = (current.planSnapshot ?? {}) as Record<string, any>;
          const allBranches = snap.allBranchAccess ?? current.plan.allBranchAccess;
          const branchOk = allBranches || m.homeBranchId === branchId || current.plan.branches.some((b) => b.branchId === branchId);
          const now = hhmmIst();
          const startT: string | null = snap.accessStartTime ?? current.plan.accessStartTime;
          const endT: string | null = snap.accessEndTime ?? current.plan.accessEndTime;
          const withinPlan = !startT || !endT || (now >= startT && now <= endT);
          const withinBranch = hours.length === 0 || hours.some((h) => now >= h.opensAt && now <= h.closesAt);
          if (!branchOk) deny = "BRANCH_NOT_ALLOWED";
          else if (!withinPlan || !withinBranch) deny = "OUTSIDE_ACCESS_HOURS";
        }

        const a = await record(deny ? "DENIED" : "ALLOWED", deny, m.id, sub?.id ?? null);
        if (deny) {
          const pending = deny === "NO_ACTIVE_SUBSCRIPTION" && sub?.status === "PENDING_PAYMENT";
          return {
            attendanceId: a.id, result: "DENIED" as const, denyReason: deny,
            message: pending ? "Membership is waiting for payment. Please pay the balance at the desk." : DENY_MESSAGE[deny],
            member: card(sub),
          };
        }
        const c = card(current);
        const warn = inGrace ? " Membership has ended. This visit is in the grace period, please renew today."
          : c.daysRemaining != null && c.daysRemaining <= 5 ? ` Membership ends in ${c.daysRemaining} day${c.daysRemaining === 1 ? "" : "s"}.` : "";
        return { attendanceId: a.id, result: "ALLOWED" as const, message: `Welcome, ${firstName(m)}!${warn}`, member: c };
      });
    });
  }

  @Post("attendance/:id/check-out")
  @HttpCode(200)
  @Requires("attendance.checkin")
  checkOut(@CurrentScope() scope: S, @Param("id", ParseUUIDPipe) id: string) {
    return this.db.run(scope, async (tx) => {
      const a = await tx.attendance.findFirst({ where: { id, ...branchWhere(scope.branchIds) } });
      if (!a) throw notFound("Visit");
      if (a.result !== "ALLOWED") throw unprocessable("NOT_CHECKED_IN", "This person was not let in");
      if (a.checkOutAt) return a;
      return tx.attendance.update({ where: { id }, data: { checkOutAt: new Date() } });
    });
  }

  @Post("attendance/:id/override")
  @HttpCode(200)
  @Requires("attendance.override")
  override(@CurrentScope() scope: S, @Param("id", ParseUUIDPipe) id: string, @Body(new Zod(z.object({ reason: z.string().trim().min(5).max(300) }))) body: { reason: string }) {
    return this.db.run(scope, async (tx) => {
      const a = await tx.attendance.findFirst({ where: { id, ...branchWhere(scope.branchIds) } });
      if (!a) throw notFound("Visit");
      if (a.result !== "DENIED") throw unprocessable("NOT_DENIED", "This visit was already allowed");
      if (!a.memberId) throw unprocessable("NO_MEMBER", "There's no member on this attempt to let in");
      if (Date.now() - a.checkInAt.getTime() > 2 * 3600_000) throw unprocessable("TOO_OLD", "Overrides are only allowed within 2 hours of the attempt");
      const after = await tx.attendance.update({ where: { id }, data: { result: "ALLOWED", overrideReason: body.reason } });
      await this.audit.log(tx, { userId: scope.userId, branchId: a.branchId, action: "attendance.override", entityType: "Attendance", entityId: id, before: { result: a.result, denyReason: a.denyReason }, after: { result: "ALLOWED", reason: body.reason } });
      return after;
    });
  }

  @Get("attendance")
  @Requires("attendance.read", "attendance.read.assigned")
  list(@CurrentScope() scope: S, @CurrentAuth() auth: AuthContext, @Query(new Zod(listQ)) q: z.infer<typeof listQ>) {
    const day = q.date ?? istDate();
    return this.db.run(scope, async (tx) => {
      const where: Prisma.AttendanceWhereInput = {
        ...branchWhere(scope.branchIds),
        ...(q.branchId ? { branchId: q.branchId } : {}),
        ...(q.memberId ? { memberId: q.memberId } : { checkInAt: { gte: istDayStart(day), lt: istDayStart(addDays(day, 1)) } }),
        ...(q.result ? { result: q.result } : {}),
        ...(q.inside === "true" ? { result: "ALLOWED", checkOutAt: null, checkInAt: { gte: new Date(Date.now() - INSIDE_HOURS * 3600_000) } } : {}),
        ...(scope.permission === "attendance.read.assigned"
          ? { member: { trainerAssignments: { some: { trainerId: auth.staffId ?? "00000000-0000-0000-0000-000000000000", endedAt: null } } } }
          : {}),
      };
      const dayWhere: Prisma.AttendanceWhereInput = {
        ...branchWhere(scope.branchIds), ...(q.branchId ? { branchId: q.branchId } : {}),
        checkInAt: { gte: istDayStart(day), lt: istDayStart(addDays(day, 1)) },
      };
      const [total, rows, allowed, denied, inside] = await Promise.all([
        tx.attendance.count({ where }),
        tx.attendance.findMany({
          where, orderBy: { checkInAt: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize,
          include: { member: { select: { id: true, firstName: true, lastName: true, memberCode: true } }, operator: { select: { displayName: true } }, branch: { select: { name: true } } },
        }),
        tx.attendance.count({ where: { ...dayWhere, result: "ALLOWED" } }),
        tx.attendance.count({ where: { ...dayWhere, result: "DENIED" } }),
        tx.attendance.count({ where: { ...dayWhere, result: "ALLOWED", checkOutAt: null, checkInAt: { gte: new Date(Date.now() - INSIDE_HOURS * 3600_000) } } }),
      ]);
      return {
        date: day, page: q.page, pageSize: q.pageSize, total,
        summary: { checkIns: allowed, denied, insideNow: day === istDate() ? inside : 0 },
        data: rows.map((a) => ({
          id: a.id, memberId: a.memberId, memberName: a.member ? [a.member.firstName, a.member.lastName].filter(Boolean).join(" ") : null,
          memberCode: a.member?.memberCode ?? null, branchName: a.branch.name, method: a.method, result: a.result, denyReason: a.denyReason,
          overrideReason: a.overrideReason, checkInAt: a.checkInAt, checkOutAt: a.checkOutAt, operatorName: a.operator?.displayName ?? null,
        })),
      };
    });
  }

  /** Visit history for one member, with simple stats for the profile. */
  @Get("members/:id/attendance")
  @Requires("attendance.read", "attendance.read.assigned", "members.read")
  async memberVisits(@CurrentScope() scope: S, @CurrentAuth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.db.run(scope, async (tx) => {
      const assignedOnly = scope.permission === "attendance.read.assigned"
        ? { trainerAssignments: { some: { trainerId: auth.staffId ?? "00000000-0000-0000-0000-000000000000", endedAt: null } } } : {};
      const m = await tx.member.findFirst({ where: { id, deletedAt: null, ...branchWhere(scope.branchIds, "homeBranchId"), ...assignedOnly }, select: { id: true } });
      if (!m) throw notFound("Member");
      const today = istDate();
      const monthStart = istDayStart(today.slice(0, 8) + "01");
      const [visits, thisMonth, last30] = await Promise.all([
        tx.attendance.findMany({ where: { memberId: id }, orderBy: { checkInAt: "desc" }, take: 40, include: { branch: { select: { name: true } } } }),
        tx.attendance.count({ where: { memberId: id, result: "ALLOWED", checkInAt: { gte: monthStart } } }),
        tx.attendance.count({ where: { memberId: id, result: "ALLOWED", checkInAt: { gte: istDayStart(addDays(today, -29)) } } }),
      ]);
      const lastVisit = visits.find((v) => v.result === "ALLOWED");
      return {
        thisMonth, last30Days: last30,
        lastVisitAt: lastVisit?.checkInAt ?? null,
        daysSinceLastVisit: lastVisit ? diffDays(istDate(lastVisit.checkInAt), today) : null,
        visits: visits.map((v) => ({ id: v.id, branchName: v.branch.name, method: v.method, result: v.result, denyReason: v.denyReason, overrideReason: v.overrideReason, checkInAt: v.checkInAt, checkOutAt: v.checkOutAt })),
      };
    });
  }

  /** Lost card: invalidate the old QR (and optionally set a new RFID tag). */
  @Post("members/:id/credential/rotate")
  @HttpCode(200)
  @Requires("members.credential.rotate")
  rotate(@CurrentScope() scope: S, @Param("id", ParseUUIDPipe) id: string, @Body(new Zod(z.object({ rfidTag: z.string().trim().min(3).max(60).nullish() }))) body: { rfidTag?: string | null }) {
    return this.db.run(scope, async (tx) => {
      const m = await tx.member.findFirst({ where: { id, deletedAt: null, ...branchWhere(scope.branchIds, "homeBranchId") } });
      if (!m) throw notFound("Member");
      const updated = await tx.member.update({
        where: { id },
        data: { qrToken: randomBytes(24).toString("base64url"), ...(body.rfidTag !== undefined ? { rfidTag: body.rfidTag } : {}) },
      });
      await this.audit.log(tx, { userId: scope.userId, branchId: m.homeBranchId, action: "member.credential.rotate", entityType: "Member", entityId: id, metadata: { rfidChanged: body.rfidTag !== undefined } });
      return { qrToken: updated.qrToken, rfidTag: updated.rfidTag };
    });
  }
}
