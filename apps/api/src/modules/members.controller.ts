import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { AuditService } from "../core/audit.service";
import { AuthContext, CurrentAuth, CurrentScope, has, Requires } from "../core/auth";
import { dbDate, istDate, ymd, addDays, diffDays } from "../core/dates";
import { branchWhere, Db, inScope, Scope, Tx } from "../core/db.service";
import { conflict, forbidden, notFound } from "../core/errors";
import { Idempotency } from "../core/idempotency.service";
import type { Permission } from "../core/permissions";
import { listQuery, Zod, zDate, zPaise, zPhoneLoose, zUuid } from "../core/validation";
import { BillingService } from "./billing.service";
import { MessagingService } from "./messaging.service";
import { freezeAllowance } from "./freeze.controller";
import type { Prisma } from "../generated/prisma/client";
import { randomBytes } from "node:crypto";

type S = Scope & { permission: Permission };

const emergency = z.object({ name: z.string().max(100).optional(), phone: zPhoneLoose.optional(), relation: z.string().max(40).optional() });

export const memberCreate = z.object({
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().max(60).optional(),
  phone: zPhoneLoose,
  email: z.string().trim().toLowerCase().email().optional().or(z.literal("").transform(() => undefined)),
  dateOfBirth: zDate.optional(),
  gender: z.enum(["MALE", "FEMALE", "OTHER", "UNDISCLOSED"]).optional(),
  addressLine1: z.string().max(200).optional(),
  addressLine2: z.string().max(200).optional(),
  city: z.string().max(80).optional(),
  pincode: z.string().regex(/^[1-9]\d{5}$/).optional().or(z.literal("").transform(() => undefined)),
  emergencyContact: emergency.optional(),
  homeBranchId: zUuid,
  joinedOn: zDate.optional(),
  privacyNoticeVersion: z.string().min(1).max(20),
  marketingConsents: z.array(z.enum(["MARKETING_WHATSAPP", "MARKETING_SMS", "MARKETING_EMAIL"])).default([]),
  confirmNotDuplicate: z.boolean().default(false),
});

const memberUpdate = memberCreate
  .omit({ homeBranchId: true, privacyNoticeVersion: true, marketingConsents: true, confirmNotDuplicate: true, joinedOn: true })
  .partial();

const memberList = listQuery.extend({
  status: z.string().optional().transform((s) => (s ? s.split(",") : undefined))
    .pipe(z.array(z.enum(["PROSPECT", "ACTIVE", "EXPIRED", "FROZEN", "CANCELLED"])).optional()),
  expiringWithinDays: z.coerce.number().int().min(0).max(90).optional(),
  hasDues: z.enum(["true", "false"]).optional(),
  sort: z.enum(["name", "-joinedOn", "joinedOn", "expiry"]).default("-joinedOn"),
});

export const paymentInput = z.object({
  method: z.enum(["CASH", "UPI", "CARD", "BANK_TRANSFER"]),
  amountPaise: z.number().int().min(1).max(100_000_000),
  referenceNumber: z.string().trim().max(60).optional(),
});

export const sellBody = z.object({
  planId: zUuid,
  startDate: zDate.optional(),
  discountPaise: zPaise.optional(),
  waiveRegistrationFee: z.boolean().default(false),
  payment: paymentInput.optional(),
});

const LIVE = ["ACTIVE", "SCHEDULED", "FROZEN"] as const;

function mask(phone: string) {
  return phone.length > 6 ? phone.slice(0, 5) + "X".repeat(phone.length - 7) + phone.slice(-2) : phone;
}

/** Trainers holding only `members.read.assigned` see their assigned members only. */
function assignedFilter(scope: S, auth: AuthContext): Prisma.MemberWhereInput {
  if (scope.permission !== "members.read.assigned") return {};
  return { trainerAssignments: { some: { trainerId: auth.staffId ?? "00000000-0000-0000-0000-000000000000", endedAt: null } } };
}

export async function duesByMember(tx: Tx, memberIds: string[]): Promise<Map<string, number>> {
  if (memberIds.length === 0) return new Map();
  const rows = await tx.$queryRaw<{ memberId: string; due: bigint }[]>`
    SELECT "memberId", SUM("duePaise")::bigint AS due FROM invoice_balance
    WHERE "memberId" = ANY(${memberIds}::uuid[]) GROUP BY "memberId"`;
  return new Map(rows.map((r) => [r.memberId, Number(r.due)]));
}

export async function createMemberTx(tx: Tx, audit: AuditService, userId: string, body: z.infer<typeof memberCreate>, leadId?: string, messaging?: MessagingService) {
  if (!body.confirmNotDuplicate) {
    const dupes = await tx.member.findMany({
      where: { deletedAt: null, OR: [{ phone: body.phone }, ...(body.email ? [{ email: body.email }] : [])] },
      select: { id: true, memberCode: true, firstName: true, lastName: true, phone: true, status: true },
      take: 5,
    });
    if (dupes.length) {
      throw conflict("POSSIBLE_DUPLICATE", "A member with this phone or email already exists", {
        candidates: dupes.map((d) => ({ id: d.id, memberCode: d.memberCode, fullName: [d.firstName, d.lastName].filter(Boolean).join(" "), phoneMasked: mask(d.phone), status: d.status })),
      });
    }
  }
  const branch = await tx.branch.findFirst({ where: { id: body.homeBranchId, status: "ACTIVE" } });
  if (!branch) throw notFound("Branch");
  const [{ n }] = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('member_code_seq') AS n`;

  const member = await tx.member.create({
    data: {
      memberCode: `${branch.code}-${String(n).padStart(6, "0")}`,
      homeBranchId: branch.id,
      firstName: body.firstName,
      lastName: body.lastName,
      phone: body.phone,
      email: body.email,
      dateOfBirth: body.dateOfBirth ? dbDate(body.dateOfBirth) : undefined,
      gender: body.gender,
      addressLine1: body.addressLine1,
      addressLine2: body.addressLine2,
      city: body.city,
      pincode: body.pincode,
      emergencyName: body.emergencyContact?.name,
      emergencyPhone: body.emergencyContact?.phone,
      emergencyRelation: body.emergencyContact?.relation,
      qrToken: randomBytes(24).toString("base64url"),
      joinedOn: dbDate(body.joinedOn ?? istDate()),
      convertedFromLeadId: leadId,
      createdById: userId,
    },
  });
  // Consent ledger: privacy notice acknowledged + each marketing channel.
  const consents = [
    { purpose: "PRIVACY_NOTICE" as const, granted: true },
    ...(["MARKETING_WHATSAPP", "MARKETING_SMS", "MARKETING_EMAIL"] as const).map((p) => ({ purpose: p, granted: body.marketingConsents.includes(p) })),
  ];
  await tx.consentRecord.createMany({
    data: consents.map((c) => ({ ...c, memberId: member.id, noticeVersion: body.privacyNoticeVersion, channel: "front_desk", recordedById: userId })),
  });
  await audit.log(tx, { userId, branchId: branch.id, action: "member.create", entityType: "Member", entityId: member.id, after: { memberCode: member.memberCode, leadId } });
  await messaging?.queue(tx, { key: "welcome", memberId: member.id, phone: member.phone, dedupeKey: `welcome:${member.id}`, vars: { firstName: member.firstName, memberCode: member.memberCode } });
  return member;
}

@Controller()
export class MembersController {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly billing: BillingService,
    private readonly idem: Idempotency,
  ) {}

  @Get("members")
  @Requires("members.read", "members.read.assigned")
  list(@CurrentScope() scope: S, @CurrentAuth() auth: AuthContext, @Query(new Zod(memberList)) q: z.infer<typeof memberList>) {
    return this.db.run(scope, async (tx) => {
      const today = istDate();
      const where: Prisma.MemberWhereInput = {
        deletedAt: null,
        ...branchWhere(scope.branchIds, "homeBranchId"),
        ...(q.branchId ? { homeBranchId: q.branchId } : {}),
        ...(q.status ? { status: { in: q.status } } : {}),
        ...assignedFilter(scope, auth),
      };
      if (q.q) {
        const digits = q.q.replace(/\D/g, "");
        where.OR = [
          { firstName: { contains: q.q, mode: "insensitive" } },
          { lastName: { contains: q.q, mode: "insensitive" } },
          { memberCode: { contains: q.q, mode: "insensitive" } },
          ...(digits.length >= 4 ? [{ phone: { contains: digits } }] : []),
        ];
      }
      if (q.expiringWithinDays !== undefined) {
        where.subscriptions = {
          some: { status: { in: ["ACTIVE"] }, endDate: { gte: dbDate(today), lte: dbDate(addDays(today, q.expiringWithinDays)) } },
        };
      }
      if (q.hasDues === "true") {
        const ids = await tx.$queryRaw<{ memberId: string }[]>`SELECT DISTINCT "memberId" FROM invoice_balance WHERE "duePaise" > 0`;
        where.id = { in: ids.map((r) => r.memberId) };
      }
      const orderBy: Prisma.MemberOrderByWithRelationInput[] =
        q.sort === "name" ? [{ firstName: "asc" }, { lastName: "asc" }] : q.sort === "joinedOn" ? [{ joinedOn: "asc" }] : [{ joinedOn: "desc" }, { createdAt: "desc" }];

      const [total, rows] = await Promise.all([
        tx.member.count({ where }),
        tx.member.findMany({
          where, orderBy, skip: (q.page - 1) * q.pageSize, take: q.pageSize,
          include: {
            subscriptions: { where: { status: { in: [...LIVE, "EXPIRED", "PENDING_PAYMENT"] } }, orderBy: { endDate: "desc" }, take: 1, include: { plan: { select: { name: true } } } },
          },
        }),
      ]);
      const dues = await duesByMember(tx, rows.map((r) => r.id));
      const canSeeDues = has(auth, "invoices.read");
      return {
        page: q.page, pageSize: q.pageSize, total,
        data: rows.map((m) => {
          const s = m.subscriptions[0];
          return {
            id: m.id, memberCode: m.memberCode, fullName: [m.firstName, m.lastName].filter(Boolean).join(" "),
            phoneMasked: mask(m.phone), homeBranchId: m.homeBranchId, status: m.status,
            currentPlanName: s?.plan.name ?? null, validUntil: s ? ymd(s.endDate) : null,
            daysRemaining: s && s.status === "ACTIVE" ? diffDays(today, ymd(s.endDate)) : null,
            duesPaise: canSeeDues ? dues.get(m.id) ?? 0 : undefined,
            joinedOn: ymd(m.joinedOn),
          };
        }),
      };
    });
  }

  @Get("members/lookup")
  @Requires("members.read")
  lookup(@CurrentScope() scope: S, @Query("phone") phone?: string, @Query("code") code?: string) {
    if (!phone && !code) return [];
    return this.db.run(scope, async (tx) => {
      const rows = await tx.member.findMany({
        where: { deletedAt: null, ...(code ? { memberCode: code.toUpperCase() } : { phone: zPhoneLoose.parse(phone) }) },
        take: 5,
      });
      return rows.map((m) => ({ id: m.id, memberCode: m.memberCode, fullName: [m.firstName, m.lastName].filter(Boolean).join(" "), phoneMasked: mask(m.phone), status: m.status }));
    });
  }

  @Post("members")
  @Requires("members.create")
  create(@CurrentScope() scope: S, @Body(new Zod(memberCreate)) body: z.infer<typeof memberCreate>) {
    if (!inScope(scope.branchIds, body.homeBranchId)) throw forbidden("You can't register members at that branch");
    return this.db.run(scope, async (tx) => {
      const m = await createMemberTx(tx, this.audit, scope.userId, body, undefined, this.billing.messaging);
      return this.detail(tx, m.id, true, true);
    });
  }

  @Get("members/:id")
  @Requires("members.read", "members.read.assigned")
  get(@CurrentScope() scope: S, @CurrentAuth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.db.run(scope, async (tx) => {
      const ok = await tx.member.count({ where: { id, deletedAt: null, ...branchWhere(scope.branchIds, "homeBranchId"), ...assignedFilter(scope, auth) } });
      if (!ok) throw notFound("Member");
      return this.detail(tx, id, has(auth, "invoices.read"), has(auth, "attendance.checkin") || has(auth, "members.credential.rotate"));
    });
  }

  @Patch("members/:id")
  @Requires("members.update")
  update(@CurrentScope() scope: S, @Param("id", ParseUUIDPipe) id: string, @Body(new Zod(memberUpdate)) body: z.infer<typeof memberUpdate>) {
    return this.db.run(scope, async (tx) => {
      const before = await tx.member.findFirst({ where: { id, deletedAt: null, ...branchWhere(scope.branchIds, "homeBranchId") } });
      if (!before) throw notFound("Member");
      const { emergencyContact, dateOfBirth, ...rest } = body;
      const data: Prisma.MemberUpdateInput = {
        ...rest,
        ...(dateOfBirth !== undefined ? { dateOfBirth: dbDate(dateOfBirth) } : {}),
        ...(emergencyContact ? { emergencyName: emergencyContact.name, emergencyPhone: emergencyContact.phone, emergencyRelation: emergencyContact.relation } : {}),
      };
      const after = await tx.member.update({ where: { id }, data });
      const changed = Object.keys(data).filter((k) => JSON.stringify((before as any)[k]) !== JSON.stringify((after as any)[k]));
      await this.audit.log(tx, {
        userId: scope.userId, branchId: before.homeBranchId, action: "member.update", entityType: "Member", entityId: id,
        before: Object.fromEntries(changed.map((k) => [k, (before as any)[k]])),
        after: Object.fromEntries(changed.map((k) => [k, (after as any)[k]])),
      });
      return this.detail(tx, id, true, true);
    });
  }

  @Get("members/:id/subscriptions")
  @Requires("members.read", "members.read.assigned")
  subscriptions(@CurrentScope() scope: S, @Param("id", ParseUUIDPipe) id: string) {
    return this.db.run(scope, async (tx) => {
      const m = await tx.member.findFirst({ where: { id, ...branchWhere(scope.branchIds, "homeBranchId") }, select: { id: true } });
      if (!m) throw notFound("Member");
      const subs = await tx.subscription.findMany({ where: { memberId: id }, orderBy: { startDate: "desc" }, include: { plan: { select: { name: true } } } });
      return subs.map(serialiseSub);
    });
  }

  @Post("checkout/quote")
  @HttpCode(200)
  @Requires("subscriptions.sell")
  quote(@CurrentScope() scope: S, @CurrentAuth() auth: AuthContext, @Body(new Zod(sellBody.extend({ memberId: zUuid }))) body: z.infer<typeof sellBody> & { memberId: string }) {
    return this.db.run(scope, (tx) =>
      this.billing.quoteMembership(tx, body, { unlimitedDiscount: has(auth, "subscriptions.discount.unlimited"), canBackdate: has(auth, "subscriptions.backdate") }),
    );
  }

  @Post("members/:id/subscriptions")
  @Requires("subscriptions.sell")
  sell(
    @CurrentScope() scope: S,
    @CurrentAuth() auth: AuthContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body(new Zod(sellBody)) body: z.infer<typeof sellBody>,
  ) {
    if (body.payment && !has(auth, "payments.collect")) throw forbidden("You can't record payments");
    return this.idem.run(scope.userId, key, `POST /members/${id}/subscriptions`, body, () =>
      this.db.run(scope, async (tx) => {
        const m = await tx.member.findFirst({ where: { id, deletedAt: null, ...branchWhere(scope.branchIds, "homeBranchId") } });
        if (!m) throw notFound("Member");
        const quote = await this.billing.quoteMembership(tx, { memberId: id, ...body }, {
          unlimitedDiscount: has(auth, "subscriptions.discount.unlimited"), canBackdate: has(auth, "subscriptions.backdate"),
        });
        const r = await this.billing.sellMembership(tx, scope.userId, id, quote, body.payment);
        return { subscription: serialiseSub({ ...r.subscription, plan: { name: quote.planName } }), invoice: r.invoice, payment: r.payment };
      }),
    );
  }

  /** Full profile: current membership, dues, invoices, recent payments, trainer, consent. */
  private async detail(tx: Tx, id: string, withMoney: boolean, withCredential = false) {
    const m = await tx.member.findUniqueOrThrow({
      where: { id },
      include: {
        homeBranch: { select: { id: true, name: true, code: true } },
        subscriptions: { orderBy: { startDate: "desc" }, include: { plan: true, freezes: { orderBy: { startDate: "asc" } } } },
        trainerAssignments: { where: { endedAt: null }, include: { trainer: { include: { user: { select: { displayName: true } } } } } },
        consents: { orderBy: { recordedAt: "desc" } },
      },
    });
    const today = istDate();
    const current =
      m.subscriptions.find((s) => s.status === "ACTIVE" && ymd(s.startDate) <= today && ymd(s.endDate) >= today) ??
      m.subscriptions.find((s) => s.status === "FROZEN") ?? null;
    const consentState = new Map<string, { granted: boolean; recordedAt: Date }>();
    for (const c of m.consents) if (!consentState.has(c.purpose)) consentState.set(c.purpose, { granted: c.granted, recordedAt: c.recordedAt });

    let money = {};
    if (withMoney) {
      const invoices = await tx.invoice.findMany({ where: { memberId: id, status: { not: "DRAFT" } }, orderBy: { createdAt: "desc" }, include: { allocations: true }, take: 20 });
      const payments = await tx.payment.findMany({ where: { memberId: id }, orderBy: { receivedAt: "desc" }, take: 20 });
      const due = (await duesByMember(tx, [id])).get(id) ?? 0;
      const credit = payments.reduce((s, p) => s + p.unallocatedPaise, 0);
      money = {
        duesPaise: due,
        creditPaise: credit,
        invoices: invoices.map((i) => {
          const paid = i.allocations.reduce((s, a) => s + a.amountPaise, 0);
          return { id: i.id, invoiceNumber: i.invoiceNumber, status: i.status, issueDate: i.issueDate && ymd(i.issueDate), totalPaise: i.totalPaise, paidPaise: paid, duePaise: i.status === "VOID" ? 0 : i.totalPaise - paid };
        }),
        payments: payments.map((p) => ({ id: p.id, receiptNumber: p.receiptNumber, method: p.method, amountPaise: p.amountPaise, unallocatedPaise: p.unallocatedPaise, referenceNumber: p.referenceNumber, receivedAt: p.receivedAt })),
      };
    }
    const t = m.trainerAssignments[0]?.trainer;
    return {
      id: m.id, memberCode: m.memberCode, firstName: m.firstName, lastName: m.lastName,
      fullName: [m.firstName, m.lastName].filter(Boolean).join(" "),
      phone: m.phone, email: m.email, dateOfBirth: m.dateOfBirth && ymd(m.dateOfBirth),
      age: m.dateOfBirth ? Math.floor(diffDays(ymd(m.dateOfBirth), today) / 365.25) : null,
      gender: m.gender, addressLine1: m.addressLine1, addressLine2: m.addressLine2, city: m.city, pincode: m.pincode,
      emergencyContact: { name: m.emergencyName, phone: m.emergencyPhone, relation: m.emergencyRelation },
      homeBranch: m.homeBranch, status: m.status, hasAccessRestriction: m.hasAccessRestriction, restrictionNote: m.restrictionNote,
      joinedOn: ymd(m.joinedOn), createdAt: m.createdAt, updatedAt: m.updatedAt,
      currentSubscription: current ? {
        ...serialiseSub(current),
        freeze: freezeAllowance(current),
        freezes: current.freezes.map((f) => ({ id: f.id, startDate: ymd(f.startDate), endDate: ymd(f.endDate), endedEarlyOn: f.endedEarlyOn ? ymd(f.endedEarlyOn) : null, reason: f.reason })),
      } : null,
      subscriptions: m.subscriptions.map(serialiseSub),
      ...(withCredential ? { qrToken: m.qrToken, rfidTag: m.rfidTag } : {}),
      currentTrainer: t ? { id: t.id, displayName: t.user.displayName } : null,
      consents: Object.fromEntries(consentState),
      ...money,
    };
  }
}

export function serialiseSub(s: { id: string; memberId: string; planId: string; status: string; startDate: Date; endDate: Date; originalEndDate: Date; invoiceId: string | null; previousSubscriptionId: string | null; plan?: { name: string } }) {
  const today = istDate();
  const end = ymd(s.endDate);
  return {
    id: s.id, memberId: s.memberId, planId: s.planId, planName: s.plan?.name, status: s.status,
    startDate: ymd(s.startDate), endDate: end, originalEndDate: ymd(s.originalEndDate),
    daysRemaining: ["ACTIVE", "SCHEDULED", "FROZEN"].includes(s.status) ? Math.max(0, diffDays(today, end) + 1) : 0,
    invoiceId: s.invoiceId, previousSubscriptionId: s.previousSubscriptionId,
  };
}
