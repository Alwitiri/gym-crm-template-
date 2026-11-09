import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { AuditService } from "../core/audit.service";
import { AuthContext, CurrentAuth, CurrentScope, has, Requires } from "../core/auth";
import { branchWhere, Db, inScope, Scope, Tx } from "../core/db.service";
import { conflict, forbidden, notFound, unprocessable } from "../core/errors";
import { Idempotency } from "../core/idempotency.service";
import type { Permission } from "../core/permissions";
import { listQuery, Zod, zPhoneLoose, zUuid } from "../core/validation";
import type { Prisma } from "../generated/prisma/client";
import { BillingService } from "./billing.service";
import { createMemberTx, memberCreate, paymentInput, serialiseSub } from "./members.controller";

type S = Scope & { permission: Permission };

const STAGES = ["NEW", "CONTACTED", "TRIAL_SCHEDULED", "TRIAL_COMPLETED", "FOLLOW_UP", "CONVERTED", "LOST"] as const;
const SOURCES = ["WALK_IN", "WEBSITE", "INSTAGRAM", "FACEBOOK", "GOOGLE_ADS", "WHATSAPP", "REFERRAL", "PHONE_CALL", "OTHER"] as const;

const leadInput = z.object({
  name: z.string().trim().min(2).max(100),
  phone: zPhoneLoose,
  email: z.string().trim().toLowerCase().email().optional().or(z.literal("").transform(() => undefined)),
  branchId: zUuid,
  source: z.enum(SOURCES),
  sourceDetail: z.string().max(120).optional(),
  interestedPlanId: zUuid.nullish(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).default("MEDIUM"),
  assignedToId: zUuid.nullish(),
  nextFollowUpAt: z.string().datetime({ offset: true }).nullish(),
  notes: z.string().max(2000).optional(),
  confirmNotDuplicate: z.boolean().default(false),
});
const leadUpdate = leadInput.omit({ confirmNotDuplicate: true, notes: true, branchId: true }).partial();

const leadList = listQuery.extend({
  stage: z.string().optional().transform((s) => (s ? s.split(",") : undefined)).pipe(z.array(z.enum(STAGES)).optional()),
  source: z.enum(SOURCES).optional(),
  assignedToId: zUuid.optional(),
  followUpDue: z.enum(["true", "false"]).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).default(100),
});

const stageBody = z.object({
  stage: z.enum(["NEW", "CONTACTED", "TRIAL_SCHEDULED", "TRIAL_COMPLETED", "FOLLOW_UP", "LOST"]),
  lostReason: z.string().trim().min(2).max(200).optional(),
  nextFollowUpAt: z.string().datetime({ offset: true }).nullish(),
});

const activityBody = z.object({
  type: z.enum(["NOTE", "CALL", "WHATSAPP", "SMS", "EMAIL", "VISIT"]),
  notes: z.string().trim().max(2000).optional(),
  nextFollowUpAt: z.string().datetime({ offset: true }).nullish(),
});

const convertBody = z.object({
  member: memberCreate.omit({ homeBranchId: true, firstName: true, phone: true }).extend({
    firstName: z.string().trim().min(1).max(60).optional(),
    phone: zPhoneLoose.optional(),
  }),
  planId: zUuid.optional(),
  discountPaise: z.number().int().min(0).optional(),
  payment: paymentInput.optional(),
});

function assignedOnly(scope: S, auth: AuthContext): Prisma.LeadWhereInput {
  return scope.permission === "leads.read.assigned" ? { assignedToId: auth.userId } : {};
}

function serialise(l: any) {
  return {
    id: l.id, name: l.name, phone: l.phone, email: l.email, branchId: l.branchId, source: l.source, sourceDetail: l.sourceDetail,
    interestedPlanId: l.interestedPlanId, interestedPlanName: l.interestedPlan?.name, stage: l.stage, priority: l.priority,
    assignedToId: l.assignedToId, assignedToName: l.assignedTo?.displayName ?? null, nextFollowUpAt: l.nextFollowUpAt,
    lostReason: l.lostReason, convertedMemberId: l.member?.id ?? null, createdAt: l.createdAt, updatedAt: l.updatedAt,
    lastActivityAt: l.activities?.[0]?.occurredAt ?? null,
  };
}

const include = {
  assignedTo: { select: { displayName: true } },
  interestedPlan: { select: { name: true } },
  member: { select: { id: true } },
  activities: { orderBy: { occurredAt: "desc" as const }, take: 1, select: { occurredAt: true } },
};

@Controller("leads")
export class LeadsController {
  constructor(private readonly db: Db, private readonly audit: AuditService, private readonly billing: BillingService, private readonly idem: Idempotency) {}

  @Get()
  @Requires("leads.read", "leads.read.assigned")
  list(@CurrentScope() scope: S, @CurrentAuth() auth: AuthContext, @Query(new Zod(leadList)) q: z.infer<typeof leadList>) {
    return this.db.run(scope, async (tx) => {
      const base: Prisma.LeadWhereInput = {
        deletedAt: null, ...branchWhere(scope.branchIds), ...assignedOnly(scope, auth),
        ...(q.branchId ? { branchId: q.branchId } : {}), ...(q.source ? { source: q.source } : {}),
        ...(q.assignedToId ? { assignedToId: q.assignedToId } : {}),
        ...(q.followUpDue === "true" ? { nextFollowUpAt: { lte: new Date() }, stage: { notIn: ["CONVERTED", "LOST"] } } : {}),
        ...(q.q ? { OR: [{ name: { contains: q.q, mode: "insensitive" } }, { phone: { contains: q.q.replace(/\D/g, "") || q.q } }] } : {}),
      };
      const where = { ...base, ...(q.stage ? { stage: { in: q.stage } } : {}) };
      const [total, rows, counts] = await Promise.all([
        tx.lead.count({ where }),
        tx.lead.findMany({ where, include, orderBy: [{ nextFollowUpAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
        tx.lead.groupBy({ by: ["stage"], where: base, _count: { _all: true } }),
      ]);
      return {
        page: q.page, pageSize: q.pageSize, total,
        stageCounts: Object.fromEntries(STAGES.map((s) => [s, counts.find((c) => c.stage === s)?._count._all ?? 0])),
        data: rows.map(serialise),
      };
    });
  }

  @Post()
  @Requires("leads.create")
  create(@CurrentScope() scope: S, @Body(new Zod(leadInput)) body: z.infer<typeof leadInput>) {
    if (!inScope(scope.branchIds, body.branchId)) throw forbidden("You can't add leads at that branch");
    return this.db.run(scope, async (tx) => {
      if (!body.confirmNotDuplicate) {
        const [openLeads, members] = await Promise.all([
          tx.lead.findMany({ where: { phone: body.phone, deletedAt: null, stage: { notIn: ["CONVERTED", "LOST"] } }, select: { id: true, name: true, stage: true }, take: 3 }),
          tx.member.findMany({ where: { phone: body.phone, deletedAt: null }, select: { id: true, firstName: true, memberCode: true }, take: 3 }),
        ]);
        if (openLeads.length || members.length) {
          throw conflict("POSSIBLE_DUPLICATE", members.length ? "This phone number belongs to an existing member" : "There is already an open lead with this phone number", { leads: openLeads, members });
        }
      }
      const { notes, confirmNotDuplicate, nextFollowUpAt, ...data } = body;
      const lead = await tx.lead.create({ data: { ...data, nextFollowUpAt: nextFollowUpAt ? new Date(nextFollowUpAt) : null }, include });
      if (notes) await tx.leadActivity.create({ data: { leadId: lead.id, userId: scope.userId, type: "NOTE", notes } });
      if (body.assignedToId) await tx.leadActivity.create({ data: { leadId: lead.id, userId: scope.userId, type: "ASSIGNMENT", notes: lead.assignedTo?.displayName } });
      await this.audit.log(tx, { userId: scope.userId, branchId: lead.branchId, action: "lead.create", entityType: "Lead", entityId: lead.id, after: { source: lead.source } });
      return serialise(lead);
    });
  }

  @Get(":id")
  @Requires("leads.read", "leads.read.assigned")
  get(@CurrentScope() scope: S, @CurrentAuth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.db.run(scope, async (tx) => {
      const lead = await tx.lead.findFirst({
        where: { id, deletedAt: null, ...branchWhere(scope.branchIds), ...assignedOnly(scope, auth) },
        include,
      });
      if (!lead) throw notFound("Lead");
      const activities = await tx.leadActivity.findMany({ where: { leadId: id }, orderBy: { occurredAt: "desc" }, include: { user: { select: { displayName: true } } } });
      return {
        ...serialise(lead),
        activities: activities.map((a) => ({ id: a.id, type: a.type, notes: a.notes, fromStage: a.fromStage, toStage: a.toStage, userName: a.user.displayName, occurredAt: a.occurredAt })),
      };
    });
  }

  @Patch(":id")
  @Requires("leads.update")
  update(@CurrentScope() scope: S, @Param("id", ParseUUIDPipe) id: string, @Body(new Zod(leadUpdate)) body: z.infer<typeof leadUpdate>) {
    return this.db.run(scope, async (tx) => {
      const before = await this.mustGet(tx, scope, id);
      const { nextFollowUpAt, ...rest } = body;
      const lead = await tx.lead.update({
        where: { id },
        data: { ...rest, ...(nextFollowUpAt !== undefined ? { nextFollowUpAt: nextFollowUpAt ? new Date(nextFollowUpAt) : null } : {}) },
        include,
      });
      if (body.assignedToId !== undefined && body.assignedToId !== before.assignedToId) {
        await tx.leadActivity.create({ data: { leadId: id, userId: scope.userId, type: "ASSIGNMENT", notes: lead.assignedTo?.displayName ?? "Unassigned" } });
      }
      return serialise(lead);
    });
  }

  @Post(":id/stage")
  @Requires("leads.update")
  stage(@CurrentScope() scope: S, @Param("id", ParseUUIDPipe) id: string, @Body(new Zod(stageBody)) body: z.infer<typeof stageBody>) {
    if (body.stage === "LOST" && !body.lostReason) throw unprocessable("LOST_REASON_REQUIRED", "Say why the lead was lost");
    return this.db.run(scope, async (tx) => {
      const before = await this.mustGet(tx, scope, id);
      if (before.stage === "CONVERTED") throw conflict("ALREADY_CONVERTED", "This lead is already a member");
      const lead = await tx.lead.update({
        where: { id },
        data: {
          stage: body.stage, lostReason: body.stage === "LOST" ? body.lostReason : null,
          ...(body.nextFollowUpAt !== undefined ? { nextFollowUpAt: body.nextFollowUpAt ? new Date(body.nextFollowUpAt) : null } : {}),
          ...(body.stage === "LOST" ? { nextFollowUpAt: null } : {}),
        },
        include,
      });
      await tx.leadActivity.create({ data: { leadId: id, userId: scope.userId, type: "STAGE_CHANGE", fromStage: before.stage, toStage: body.stage, notes: body.lostReason } });
      return serialise(lead);
    });
  }

  @Post(":id/activities")
  @Requires("leads.update")
  activity(@CurrentScope() scope: S, @Param("id", ParseUUIDPipe) id: string, @Body(new Zod(activityBody)) body: z.infer<typeof activityBody>) {
    return this.db.run(scope, async (tx) => {
      const lead = await this.mustGet(tx, scope, id);
      const a = await tx.leadActivity.create({ data: { leadId: id, userId: scope.userId, type: body.type, notes: body.notes } });
      const data: Prisma.LeadUpdateInput = {};
      if (body.nextFollowUpAt !== undefined) data.nextFollowUpAt = body.nextFollowUpAt ? new Date(body.nextFollowUpAt) : null;
      if (lead.stage === "NEW" && body.type !== "NOTE") data.stage = "CONTACTED"; // first real contact moves it on
      if (Object.keys(data).length) await tx.lead.update({ where: { id }, data });
      if (data.stage) await tx.leadActivity.create({ data: { leadId: id, userId: scope.userId, type: "STAGE_CHANGE", fromStage: "NEW", toStage: "CONTACTED" } });
      return a;
    });
  }

  @Post(":id/convert")
  @Requires("leads.convert")
  convert(
    @CurrentScope() scope: S, @CurrentAuth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string,
    @Headers("idempotency-key") key: string | undefined, @Body(new Zod(convertBody)) body: z.infer<typeof convertBody>,
  ) {
    if (body.planId && !has(auth, "subscriptions.sell")) throw forbidden("You can't sell memberships");
    if (body.payment && !has(auth, "payments.collect")) throw forbidden("You can't record payments");
    return this.idem.run(scope.userId, key, `POST /leads/${id}/convert`, body, () =>
      this.db.run(scope, async (tx) => {
        const lead = await this.mustGet(tx, scope, id);
        if (lead.stage === "CONVERTED") throw conflict("ALREADY_CONVERTED", "This lead is already a member");
        const [first, ...rest] = lead.name.split(" ");
        const member = await createMemberTx(tx, this.audit, scope.userId, {
          ...body.member,
          firstName: body.member.firstName ?? first,
          lastName: body.member.lastName ?? (rest.join(" ") || undefined),
          phone: body.member.phone ?? lead.phone,
          email: body.member.email ?? lead.email ?? undefined,
          homeBranchId: lead.branchId,
          confirmNotDuplicate: body.member.confirmNotDuplicate,
        }, lead.id, this.billing.messaging);
        await tx.lead.update({ where: { id }, data: { stage: "CONVERTED", convertedAt: new Date(), nextFollowUpAt: null } });
        await tx.leadActivity.create({ data: { leadId: id, userId: scope.userId, type: "STAGE_CHANGE", fromStage: lead.stage, toStage: "CONVERTED" } });

        let sale = null;
        if (body.planId) {
          const quote = await this.billing.quoteMembership(tx, { memberId: member.id, planId: body.planId, discountPaise: body.discountPaise }, {
            unlimitedDiscount: has(auth, "subscriptions.discount.unlimited"), canBackdate: false,
          });
          const r = await this.billing.sellMembership(tx, scope.userId, member.id, quote, body.payment);
          sale = { subscription: serialiseSub({ ...r.subscription, plan: { name: quote.planName } }), invoice: r.invoice, payment: r.payment };
        }
        return { member: { id: member.id, memberCode: member.memberCode }, ...sale };
      }),
    );
  }

  private async mustGet(tx: Tx, scope: S, id: string) {
    const lead = await tx.lead.findFirst({ where: { id, deletedAt: null, ...branchWhere(scope.branchIds) } });
    if (!lead) throw notFound("Lead");
    return lead;
  }
}
