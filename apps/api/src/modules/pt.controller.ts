import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { AuditService } from "../core/audit.service";
import { AuthContext, CurrentAuth, CurrentScope, has, Requires } from "../core/auth";
import { addDays, dbDate, istDate, istDayStart, ymd } from "../core/dates";
import { branchWhere, Db, Scope, Tx } from "../core/db.service";
import { conflict, forbidden, notFound, unprocessable } from "../core/errors";
import { Idempotency } from "../core/idempotency.service";
import type { Permission } from "../core/permissions";
import { Zod, zDate, zPaise, zUuid } from "../core/validation";
import type { Prisma } from "../generated/prisma/client";
import { BillingService, line, totals } from "./billing.service";
import { paymentInput } from "./members.controller";

type S = Scope & { permission: Permission };
const NONE = "00000000-0000-0000-0000-000000000000";
/** A member cancelling with less notice than this (or not turning up) still uses the session. */
export const PT_CANCEL_NOTICE_HOURS = 12;
const PT_SAC = "999723";

const packageBody = z.object({
  name: z.string().trim().min(2).max(80),
  sessionCount: z.number().int().min(1).max(200),
  validityDays: z.number().int().min(1).max(730),
  pricePaise: zPaise,
  taxRateBp: z.number().int().min(0).max(2800).default(1800),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
});

const sellBody = z.object({
  ptPackageId: zUuid,
  trainerId: zUuid,
  discountPaise: zPaise.optional(),
  payment: paymentInput.optional(),
});

const scheduleBody = z.object({
  memberPtPackageId: zUuid,
  scheduledStart: z.string().datetime({ offset: true }),
  durationMinutes: z.number().int().min(15).max(180).default(60),
});

const listQ = z.object({
  from: zDate.optional(),
  to: zDate.optional(),
  trainerId: zUuid.optional(),
  memberId: zUuid.optional(),
  branchId: zUuid.optional(),
});

function serialisePkg(p: any, upcoming = 0) {
  return {
    id: p.id, memberId: p.memberId, ptPackageId: p.ptPackageId, packageName: p.ptPackage?.name, trainerId: p.trainerId,
    trainerName: p.trainer?.user?.displayName ?? null, invoiceId: p.invoiceId, sessionsTotal: p.sessionsTotal, sessionsUsed: p.sessionsUsed,
    sessionsBooked: upcoming, sessionsLeft: Math.max(0, p.sessionsTotal - p.sessionsUsed - upcoming),
    validFrom: ymd(p.validFrom), validUntil: ymd(p.validUntil), status: p.status,
  };
}

function serialiseSession(s: any) {
  return {
    id: s.id, memberPtPackageId: s.memberPtPackageId, memberId: s.memberId,
    memberName: s.member ? [s.member.firstName, s.member.lastName].filter(Boolean).join(" ") : null, memberCode: s.member?.memberCode ?? null,
    trainerId: s.trainerId, trainerName: s.trainer?.user?.displayName ?? null, branchId: s.branchId,
    scheduledStart: s.scheduledStart, scheduledEnd: s.scheduledEnd, status: s.status, countsAgainstPackage: s.countsAgainstPackage,
    trainerNotes: s.trainerNotes, completedAt: s.completedAt, packageName: s.memberPtPackage?.ptPackage?.name ?? null,
  };
}

const sessionInclude = {
  member: { select: { firstName: true, lastName: true, memberCode: true } },
  trainer: { include: { user: { select: { displayName: true } } } },
  memberPtPackage: { include: { ptPackage: { select: { name: true } } } },
} as const;

@Controller()
export class PtController {
  constructor(private readonly db: Db, private readonly audit: AuditService, private readonly billing: BillingService, private readonly idem: Idempotency) {}

  /** Trainers holding only pt.read.assigned work with their own sessions and packages. */
  private ownOnly(scope: S, auth: AuthContext) {
    return scope.permission === "pt.read.assigned" || (!has(auth, "pt.read") && has(auth, "pt.read.assigned"));
  }

  // ---------------- Catalogue ----------------
  @Get("pt-packages")
  @Requires("pt.read", "pt.read.assigned", "pt.sell")
  packages(@Query("status") status?: string) {
    return this.db.raw.ptPackage.findMany({
      where: status === "ACTIVE" || status === "INACTIVE" ? { status } : {},
      orderBy: [{ status: "asc" }, { sessionCount: "asc" }],
    });
  }

  @Post("pt-packages")
  @Requires("pt.packages.manage")
  async createPackage(@CurrentScope() scope: S, @Body(new Zod(packageBody)) body: z.infer<typeof packageBody>) {
    const p = await this.db.raw.ptPackage.create({ data: body });
    await this.audit.log(this.db.raw, { userId: scope.userId, action: "pt_package.create", entityType: "PtPackage", entityId: p.id, after: body });
    return p;
  }

  @Patch("pt-packages/:id")
  @Requires("pt.packages.manage")
  async updatePackage(@CurrentScope() scope: S, @Param("id", ParseUUIDPipe) id: string, @Body(new Zod(packageBody.partial())) body: Partial<z.infer<typeof packageBody>>) {
    const before = await this.db.raw.ptPackage.findUnique({ where: { id } });
    if (!before) throw notFound("PT package");
    const p = await this.db.raw.ptPackage.update({ where: { id }, data: body });
    await this.audit.log(this.db.raw, { userId: scope.userId, action: "pt_package.update", entityType: "PtPackage", entityId: id, before, after: p });
    return p;
  }

  // ---------------- Selling ----------------
  private async quote(tx: Tx, scope: S, auth: AuthContext, memberId: string, body: { ptPackageId: string; trainerId: string; discountPaise?: number }) {
    const m = await tx.member.findFirst({ where: { id: memberId, deletedAt: null, ...branchWhere(scope.branchIds, "homeBranchId") }, include: { homeBranch: true } });
    if (!m) throw notFound("Member");
    const pkg = await tx.ptPackage.findFirst({ where: { id: body.ptPackageId, status: "ACTIVE" } });
    if (!pkg) throw notFound("PT package");
    const trainer = await tx.staff.findFirst({ where: { id: body.trainerId, isTrainer: true, employmentStatus: { not: "EXITED" } }, include: { user: { select: { displayName: true } } } });
    if (!trainer) throw notFound("Trainer");
    const discount = body.discountPaise ?? 0;
    if (discount > pkg.pricePaise) throw unprocessable("DISCOUNT_TOO_LARGE", "Discount is more than the package price");
    const cap = Math.round(pkg.pricePaise * 0.1);
    if (discount > cap && !has(auth, "subscriptions.discount.unlimited")) throw forbidden(`Maximum discount you can give on this package is ₹${Math.floor(cap / 100)}`);
    const validFrom = istDate();
    const validUntil = addDays(validFrom, pkg.validityDays - 1);
    const items = [line("PT_PACKAGE", `${pkg.name}: ${pkg.sessionCount} sessions with ${trainer.user.displayName} (valid to ${validUntil})`, PT_SAC, pkg.pricePaise, discount, pkg.taxRateBp)];
    return {
      m, pkg, trainer, validFrom, validUntil,
      quote: { items, ...totals(items), placeOfSupplyStateCode: m.homeBranch.stateCode, branchId: m.homeBranchId },
    };
  }

  @Post("members/:id/pt-packages/quote")
  @HttpCode(200)
  @Requires("pt.sell")
  quoteSale(@CurrentScope() scope: S, @CurrentAuth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string, @Body(new Zod(sellBody.omit({ payment: true }))) body: { ptPackageId: string; trainerId: string; discountPaise?: number }) {
    return this.db.run(scope, async (tx) => {
      const q = await this.quote(tx, scope, auth, id, body);
      return { ...q.quote, validFrom: q.validFrom, validUntil: q.validUntil, sessionCount: q.pkg.sessionCount };
    });
  }

  @Post("members/:id/pt-packages")
  @Requires("pt.sell")
  sell(
    @CurrentScope() scope: S, @CurrentAuth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string,
    @Headers("idempotency-key") key: string | undefined, @Body(new Zod(sellBody)) body: z.infer<typeof sellBody>,
  ) {
    if (body.payment && !has(auth, "payments.collect")) throw forbidden("You can't record payments");
    return this.idem.run(scope.userId, key, `POST /members/${id}/pt-packages`, body, () =>
      this.db.run(scope, async (tx) => {
        const q = await this.quote(tx, scope, auth, id, body);
        const invoice = await this.billing.issueInvoice(tx, scope.userId, id, q.quote);
        const pkg = await tx.memberPtPackage.create({
          data: {
            memberId: id, ptPackageId: q.pkg.id, trainerId: q.trainer.id, invoiceId: invoice.id, sessionsTotal: q.pkg.sessionCount,
            validFrom: dbDate(q.validFrom), validUntil: dbDate(q.validUntil), status: "PENDING_PAYMENT",
          },
        });
        // A member who buys PT trains with that trainer.
        const current = await tx.trainerAssignment.findFirst({ where: { memberId: id, endedAt: null } });
        if (!current) await tx.trainerAssignment.create({ data: { memberId: id, trainerId: q.trainer.id } });
        let payment = null;
        if (body.payment) {
          payment = await this.billing.recordPayment(tx, scope.userId, id, q.m.homeBranchId, body.payment, [{ invoiceId: invoice.id, amountPaise: Math.min(body.payment.amountPaise, invoice.totalPaise) }]);
        }
        await this.audit.log(tx, { userId: scope.userId, branchId: q.m.homeBranchId, action: "pt_package.sell", entityType: "MemberPtPackage", entityId: pkg.id, after: { package: q.pkg.name, trainer: q.trainer.user.displayName, totalPaise: invoice.totalPaise } });
        const fresh = await tx.memberPtPackage.findUniqueOrThrow({ where: { id: pkg.id }, include: { ptPackage: true, trainer: { include: { user: { select: { displayName: true } } } } } });
        const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
        return { ptPackage: serialisePkg(fresh), invoice: inv, payment };
      }),
    );
  }

  @Get("members/:id/pt-packages")
  @Requires("pt.read", "pt.read.assigned")
  memberPackages(@CurrentScope() scope: S, @CurrentAuth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.db.run(scope, async (tx) => {
      const own = this.ownOnly(scope, auth);
      const rows = await tx.memberPtPackage.findMany({
        where: { memberId: id, member: { deletedAt: null, ...branchWhere(scope.branchIds, "homeBranchId") }, ...(own ? { trainerId: auth.staffId ?? NONE } : {}) },
        include: { ptPackage: true, trainer: { include: { user: { select: { displayName: true } } } }, sessions: { where: { status: "SCHEDULED" }, select: { id: true } } },
        orderBy: { validFrom: "desc" },
      });
      return rows.map((p) => serialisePkg(p, p.sessions.length));
    });
  }

  // ---------------- Sessions ----------------
  @Get("pt-sessions")
  @Requires("pt.read", "pt.read.assigned")
  sessions(@CurrentScope() scope: S, @CurrentAuth() auth: AuthContext, @Query(new Zod(listQ)) q: z.infer<typeof listQ>) {
    const from = q.from ?? istDate();
    const to = q.to ?? addDays(from, 6);
    return this.db.run(scope, async (tx) => {
      const where: Prisma.PtSessionWhereInput = {
        ...branchWhere(scope.branchIds), ...(q.branchId ? { branchId: q.branchId } : {}),
        scheduledStart: { gte: istDayStart(from), lt: istDayStart(addDays(to, 1)) },
        ...(q.memberId ? { memberId: q.memberId } : {}),
        ...(this.ownOnly(scope, auth) ? { trainerId: auth.staffId ?? NONE } : q.trainerId ? { trainerId: q.trainerId } : {}),
      };
      const rows = await tx.ptSession.findMany({ where, include: sessionInclude, orderBy: { scheduledStart: "asc" }, take: 500 });
      return { from, to, data: rows.map(serialiseSession) };
    });
  }

  @Post("pt-sessions")
  @Requires("pt.schedule")
  schedule(@CurrentScope() scope: S, @CurrentAuth() auth: AuthContext, @Body(new Zod(scheduleBody)) body: z.infer<typeof scheduleBody>) {
    return this.db.run(scope, async (tx) => {
      const pkg = await tx.memberPtPackage.findFirst({
        where: { id: body.memberPtPackageId, member: { deletedAt: null, ...branchWhere(scope.branchIds, "homeBranchId") } },
        include: { member: { select: { homeBranchId: true, firstName: true } }, sessions: { where: { status: "SCHEDULED" }, select: { id: true } } },
      });
      if (!pkg) throw notFound("PT package");
      if (!has(auth, "pt.read") && pkg.trainerId !== auth.staffId) throw notFound("PT package");
      if (pkg.status === "PENDING_PAYMENT") throw unprocessable("PACKAGE_UNPAID", "This PT package isn't paid yet");
      if (pkg.status !== "ACTIVE") throw unprocessable("PACKAGE_NOT_ACTIVE", `This PT package is ${pkg.status.toLowerCase()}`);
      const start = new Date(body.scheduledStart);
      if (start.getTime() < Date.now() - 12 * 3600_000) throw unprocessable("IN_PAST", "Sessions can't be booked in the past");
      const day = istDate(start);
      if (day > ymd(pkg.validUntil)) throw unprocessable("AFTER_VALIDITY", `This package is valid until ${ymd(pkg.validUntil)}`);
      const left = pkg.sessionsTotal - pkg.sessionsUsed - pkg.sessions.length;
      if (left <= 0) throw unprocessable("NO_SESSIONS_LEFT", "No sessions left to book on this package");
      try {
        const s = await tx.ptSession.create({
          data: {
            memberPtPackageId: pkg.id, memberId: pkg.memberId, trainerId: pkg.trainerId, branchId: pkg.member.homeBranchId,
            scheduledStart: start, scheduledEnd: new Date(start.getTime() + body.durationMinutes * 60_000),
          },
          include: sessionInclude,
        });
        return serialiseSession(s);
      } catch (e: any) {
        if (String(e?.message ?? "").includes("pt_trainer_no_overlap") || JSON.stringify(e?.meta ?? {}).includes("pt_trainer_no_overlap")) {
          throw conflict("TRAINER_UNAVAILABLE", "The trainer already has a session at that time");
        }
        throw e;
      }
    });
  }

  @Post("pt-sessions/:id/complete")
  @HttpCode(200)
  @Requires("pt.complete")
  complete(@CurrentScope() scope: S, @CurrentAuth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string, @Body(new Zod(z.object({ trainerNotes: z.string().trim().max(1000).optional() }))) body: { trainerNotes?: string }) {
    return this.db.run(scope, async (tx) => {
      const s = await tx.ptSession.findFirst({ where: { id, ...branchWhere(scope.branchIds) } });
      if (!s) throw notFound("Session");
      if (!has(auth, "pt.read") && s.trainerId !== auth.staffId) throw notFound("Session");
      if (s.status !== "SCHEDULED") throw unprocessable("NOT_SCHEDULED", "This session is already closed");
      if (s.scheduledStart.getTime() > Date.now() + 30 * 60_000) throw unprocessable("NOT_STARTED", "This session hasn't started yet");
      const done = await tx.ptSession.update({ where: { id }, data: { status: "COMPLETED", completedAt: new Date(), trainerNotes: body.trainerNotes, countsAgainstPackage: true }, include: sessionInclude });
      await this.usePackageSession(tx, s.memberPtPackageId);
      return serialiseSession(done);
    });
  }

  @Post("pt-sessions/:id/cancel")
  @HttpCode(200)
  @Requires("pt.schedule")
  cancel(@CurrentScope() scope: S, @CurrentAuth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string, @Body(new Zod(z.object({ by: z.enum(["MEMBER", "TRAINER"]), noShow: z.boolean().default(false), reason: z.string().trim().max(300).optional() }))) body: { by: "MEMBER" | "TRAINER"; noShow: boolean; reason?: string }) {
    return this.db.run(scope, async (tx) => {
      const s = await tx.ptSession.findFirst({ where: { id, ...branchWhere(scope.branchIds) } });
      if (!s) throw notFound("Session");
      if (!has(auth, "pt.read") && s.trainerId !== auth.staffId) throw notFound("Session");
      if (s.status !== "SCHEDULED") throw unprocessable("NOT_SCHEDULED", "This session is already closed");
      if (body.noShow && s.scheduledStart.getTime() > Date.now()) throw unprocessable("NOT_STARTED", "You can mark a no-show only after the start time");
      const lateNotice = s.scheduledStart.getTime() - Date.now() < PT_CANCEL_NOTICE_HOURS * 3600_000;
      const counts = body.noShow || (body.by === "MEMBER" && lateNotice);
      const status = body.noShow ? "NO_SHOW" : body.by === "MEMBER" ? "CANCELLED_BY_MEMBER" : "CANCELLED_BY_TRAINER";
      const updated = await tx.ptSession.update({ where: { id }, data: { status, countsAgainstPackage: counts, trainerNotes: body.reason }, include: sessionInclude });
      if (counts) await this.usePackageSession(tx, s.memberPtPackageId);
      await this.audit.log(tx, { userId: scope.userId, branchId: s.branchId, action: "pt_session.cancel", entityType: "PtSession", entityId: id, after: { status, countsAgainstPackage: counts, reason: body.reason } });
      return { ...serialiseSession(updated), message: counts ? `Session used: ${body.noShow ? "member didn't turn up" : `cancelled with less than ${PT_CANCEL_NOTICE_HOURS} hours' notice`}.` : "Session returned to the package." };
    });
  }

  private async usePackageSession(tx: Tx, memberPtPackageId: string) {
    const p = await tx.memberPtPackage.update({ where: { id: memberPtPackageId }, data: { sessionsUsed: { increment: 1 } } });
    if (p.sessionsUsed >= p.sessionsTotal) {
      await tx.memberPtPackage.update({ where: { id: p.id }, data: { status: "EXHAUSTED" } });
      // Any extra bookings beyond the package are cancelled so they don't count twice.
      await tx.ptSession.updateMany({ where: { memberPtPackageId, status: "SCHEDULED" }, data: { status: "CANCELLED_BY_TRAINER", countsAgainstPackage: false, trainerNotes: "Package used up" } });
    }
  }
}
