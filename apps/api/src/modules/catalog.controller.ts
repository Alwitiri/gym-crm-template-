import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from "@nestjs/common";
import * as argon2 from "argon2";
import { z } from "zod";
import { AuditService } from "../core/audit.service";
import { CurrentScope, Requires } from "../core/auth";
import { dbDate, istDate, ymd } from "../core/dates";
import { branchWhere, Db, inScope, Scope } from "../core/db.service";
import { AppError, conflict, forbidden, notFound } from "../core/errors";
import type { Permission } from "../core/permissions";
import { SYSTEM_ROLES } from "../core/permissions";
import { Zod, zPaise, zPhoneLoose, zUuid } from "../core/validation";

type S = Scope & { permission: Permission };
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const planInput = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().max(500).optional(),
  durationDays: z.number().int().min(1).max(3650),
  pricePaise: zPaise,
  registrationFeePaise: zPaise.default(0),
  taxRateBp: z.number().int().min(0).max(2800).default(1800),
  maxDiscountPaise: zPaise.default(0),
  freezeAllowed: z.boolean().default(false),
  maxFreezeDays: z.number().int().min(0).max(365).default(0),
  maxFreezeCount: z.number().int().min(0).max(12).default(0),
  allBranchAccess: z.boolean().default(false),
  branchIds: z.array(zUuid).default([]),
  accessStartTime: hhmm.nullish(),
  accessEndTime: hhmm.nullish(),
  facilities: z.array(z.string().max(40)).default([]),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
});

const branchInput = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,10}$/),
  name: z.string().trim().min(2).max(80),
  addressLine1: z.string().min(2).max(200),
  addressLine2: z.string().max(200).optional(),
  city: z.string().min(2).max(80),
  state: z.string().min(2).max(80),
  stateCode: z.string().regex(/^\d{2}$/),
  pincode: z.string().regex(/^[1-9]\d{5}$/),
  phone: zPhoneLoose.optional(),
  email: z.string().email().optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
});

const staffInput = z.object({
  displayName: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email().optional(),
  phone: zPhoneLoose,
  branchId: zUuid,
  designation: z.string().trim().min(2).max(60),
  isTrainer: z.boolean().default(false),
  specializations: z.array(z.string().max(40)).default([]),
  roles: z.array(z.object({ roleKey: z.string(), branchId: zUuid.nullable() })).min(1),
  initialPassword: z.string().min(10).max(128),
});

function serialisePlan(p: any) {
  return { ...p, branchIds: p.branches?.map((b: any) => b.branchId) ?? [], branches: undefined, createdAt: undefined, updatedAt: undefined };
}

@Controller()
export class CatalogController {
  constructor(private readonly db: Db, private readonly audit: AuditService) {}

  // ---------------- Branches ----------------
  @Get("branches")
  @Requires("branches.read")
  branches(@CurrentScope() scope: S) {
    return this.db.raw.branch.findMany({
      where: { ...(scope.branchIds === "*" ? {} : { id: { in: scope.branchIds } }) },
      orderBy: { code: "asc" },
      include: { openingHours: { orderBy: { dayOfWeek: "asc" } } },
    });
  }

  @Post("branches")
  @Requires("branches.manage")
  async createBranch(@CurrentScope() scope: S, @Body(new Zod(branchInput)) body: z.infer<typeof branchInput>) {
    if (scope.branchIds !== "*") throw forbidden("Only business-wide admins can add branches");
    return this.db.raw.$transaction(async (tx) => {
      const b = await tx.branch.create({ data: body });
      await this.audit.log(tx, { userId: scope.userId, branchId: b.id, action: "branch.create", entityType: "Branch", entityId: b.id, after: body });
      return b;
    });
  }

  @Patch("branches/:id")
  @Requires("branches.manage")
  async updateBranch(@CurrentScope() scope: S, @Param("id", ParseUUIDPipe) id: string, @Body(new Zod(branchInput.partial())) body: Partial<z.infer<typeof branchInput>>) {
    if (!inScope(scope.branchIds, id)) throw notFound("Branch");
    return this.db.raw.$transaction(async (tx) => {
      const before = await tx.branch.findUnique({ where: { id } });
      if (!before) throw notFound("Branch");
      const after = await tx.branch.update({ where: { id }, data: body });
      await this.audit.log(tx, { userId: scope.userId, branchId: id, action: "branch.update", entityType: "Branch", entityId: id, before, after });
      return after;
    });
  }

  /** Replace weekly opening hours. Check-in refuses entry outside them. Empty list = always open. */
  @Put("branches/:id/hours")
  @Requires("branches.manage")
  async setHours(
    @CurrentScope() scope: S, @Param("id", ParseUUIDPipe) id: string,
    @Body(new Zod(z.array(z.object({ dayOfWeek: z.number().int().min(0).max(6), opensAt: hhmm, closesAt: hhmm })).max(21))) body: { dayOfWeek: number; opensAt: string; closesAt: string }[],
  ) {
    if (!inScope(scope.branchIds, id)) throw notFound("Branch");
    for (const h of body) if (h.closesAt <= h.opensAt) throw new AppError(422, "BAD_HOURS", "Closing time must be after opening time (split overnight hours into two days)");
    return this.db.raw.$transaction(async (tx) => {
      const before = await tx.branchHours.findMany({ where: { branchId: id } });
      await tx.branchHours.deleteMany({ where: { branchId: id } });
      await tx.branchHours.createMany({ data: body.map((h) => ({ ...h, branchId: id })) });
      await this.audit.log(tx, { userId: scope.userId, branchId: id, action: "branch.hours", entityType: "Branch", entityId: id, before, after: body });
      return tx.branchHours.findMany({ where: { branchId: id }, orderBy: [{ dayOfWeek: "asc" }, { opensAt: "asc" }] });
    });
  }

  // ---------------- Plans ----------------
  @Get("membership-plans")
  @Requires("plans.read")
  async plans(@CurrentScope() scope: S, @Query("branchId") branchId?: string, @Query("status") status?: string) {
    const plans = await this.db.raw.membershipPlan.findMany({
      where: {
        ...(status === "ACTIVE" || status === "INACTIVE" ? { status } : {}),
        ...(branchId ? { OR: [{ allBranchAccess: true }, { branches: { some: { branchId } } }] } : {}),
      },
      include: { branches: true, _count: { select: { subscriptions: { where: { status: "ACTIVE" } } } } },
      orderBy: [{ status: "asc" }, { durationDays: "asc" }],
    });
    return plans.map((p) => ({ ...serialisePlan(p), activeSubscriptions: p._count.subscriptions, _count: undefined }));
  }

  @Post("membership-plans")
  @Requires("plans.manage")
  createPlan(@CurrentScope() scope: S, @Body(new Zod(planInput)) body: z.infer<typeof planInput>) {
    const { branchIds, ...data } = body;
    return this.db.raw.$transaction(async (tx) => {
      const p = await tx.membershipPlan.create({
        data: { ...data, freezeAllowed: data.freezeAllowed, maxFreezeDays: data.freezeAllowed ? data.maxFreezeDays : 0, maxFreezeCount: data.freezeAllowed ? data.maxFreezeCount : 0, branches: { create: branchIds.map((branchId) => ({ branchId })) } },
        include: { branches: true },
      });
      await this.audit.log(tx, { userId: scope.userId, action: "plan.create", entityType: "MembershipPlan", entityId: p.id, after: body });
      return serialisePlan(p);
    });
  }

  @Patch("membership-plans/:id")
  @Requires("plans.manage")
  updatePlan(@CurrentScope() scope: S, @Param("id", ParseUUIDPipe) id: string, @Body(new Zod(planInput.partial())) body: Partial<z.infer<typeof planInput>>) {
    const { branchIds, ...data } = body;
    return this.db.raw.$transaction(async (tx) => {
      const before = await tx.membershipPlan.findUnique({ where: { id }, include: { branches: true } });
      if (!before) throw notFound("Plan");
      if (data.freezeAllowed === false) Object.assign(data, { maxFreezeDays: 0, maxFreezeCount: 0 });
      if (branchIds) {
        await tx.membershipPlanBranch.deleteMany({ where: { planId: id } });
        await tx.membershipPlanBranch.createMany({ data: branchIds.map((branchId) => ({ planId: id, branchId })) });
      }
      const after = await tx.membershipPlan.update({ where: { id }, data, include: { branches: true } });
      await this.audit.log(tx, { userId: scope.userId, action: "plan.update", entityType: "MembershipPlan", entityId: id, before: serialisePlan(before), after: serialisePlan(after) });
      return serialisePlan(after);
    });
  }

  // ---------------- Staff & roles ----------------
  @Get("staff")
  @Requires("staff.read")
  async staff(@CurrentScope() scope: S, @Query("isTrainer") isTrainer?: string) {
    const rows = await this.db.raw.staff.findMany({
      where: { employmentStatus: { not: "EXITED" }, ...branchWhere(scope.branchIds), ...(isTrainer === "true" ? { isTrainer: true } : {}) },
      include: { user: { select: { displayName: true, email: true, phone: true, status: true, roles: { include: { role: { select: { key: true } } } } } } },
      orderBy: { user: { displayName: "asc" } },
    });
    return rows.map((s) => ({
      id: s.id, userId: s.userId, employeeCode: s.employeeCode, displayName: s.user.displayName, email: s.user.email, phone: s.user.phone,
      designation: s.designation, branchId: s.branchId, isTrainer: s.isTrainer, specializations: s.specializations,
      employmentStatus: s.employmentStatus, joinedOn: ymd(s.joinedOn),
      roles: s.user.roles.map((r) => ({ roleKey: r.role.key, branchId: r.branchId })),
    }));
  }

  @Post("staff")
  @Requires("staff.manage")
  async createStaff(@CurrentScope() scope: S, @Body(new Zod(staffInput)) body: z.infer<typeof staffInput>) {
    if (!inScope(scope.branchIds, body.branchId)) throw forbidden("You can't add staff at that branch");
    for (const r of body.roles) {
      if (!SYSTEM_ROLES[r.roleKey] && !(await this.db.raw.role.findUnique({ where: { key: r.roleKey } }))) throw notFound(`Role ${r.roleKey}`);
      // No privilege escalation: branch-scoped managers can only grant at their own branches, and never OWNER.
      if (scope.branchIds !== "*" && (r.branchId === null || !scope.branchIds.includes(r.branchId) || r.roleKey === "OWNER")) {
        throw forbidden("You can only grant non-owner roles at your own branches");
      }
    }
    const existing = await this.db.raw.user.findFirst({ where: { OR: [{ phone: body.phone }, ...(body.email ? [{ email: body.email }] : [])] } });
    if (existing) throw conflict("ALREADY_EXISTS", "A user with this phone or email already exists");
    const passwordHash = await argon2.hash(body.initialPassword, { type: argon2.argon2id });
    return this.db.raw.$transaction(async (tx) => {
      const roles = await tx.role.findMany({ where: { key: { in: body.roles.map((r) => r.roleKey) } } });
      const count = await tx.staff.count();
      const user = await tx.user.create({
        data: {
          displayName: body.displayName, email: body.email, phone: body.phone, passwordHash, passwordChangedAt: new Date(),
          roles: { create: body.roles.map((r) => ({ roleId: roles.find((x) => x.key === r.roleKey)!.id, branchId: r.branchId, grantedById: scope.userId })) },
        },
      });
      const staff = await tx.staff.create({
        data: {
          userId: user.id, employeeCode: `EMP-${String(count + 1).padStart(4, "0")}`, branchId: body.branchId, designation: body.designation,
          isTrainer: body.isTrainer, specializations: body.specializations, joinedOn: dbDate(istDate()),
        },
      });
      await this.audit.log(tx, { userId: scope.userId, branchId: body.branchId, action: "staff.create", entityType: "Staff", entityId: staff.id, after: { ...body, initialPassword: undefined } });
      return { id: staff.id, userId: user.id, employeeCode: staff.employeeCode };
    });
  }

  @Get("roles")
  @Requires("roles.read")
  async roles() {
    const roles = await this.db.raw.role.findMany({ include: { permissions: { include: { permission: true } } }, orderBy: { name: "asc" } });
    return roles.map((r) => ({ id: r.id, key: r.key, name: r.name, isSystem: r.isSystem, permissions: r.permissions.map((p) => p.permission.key).sort() }));
  }

  // ---------------- Invoices & payments ----------------
  @Get("invoices")
  @Requires("invoices.read")
  invoices(@CurrentScope() scope: S, @Query("memberId") memberId?: string, @Query("status") status?: string, @Query("page") page = "1") {
    const p = Math.max(1, Number(page) || 1);
    return this.db.run(scope, async (tx) => {
      const where = {
        ...branchWhere(scope.branchIds),
        ...(memberId && zUuid.safeParse(memberId).success ? { memberId } : {}),
        ...(status && ["ISSUED", "PARTIALLY_PAID", "PAID", "VOID"].includes(status) ? { status: status as any } : { status: { not: "DRAFT" as const } }),
      };
      const [total, rows] = await Promise.all([
        tx.invoice.count({ where }),
        tx.invoice.findMany({ where, orderBy: { createdAt: "desc" }, skip: (p - 1) * 25, take: 25, include: { member: { select: { firstName: true, lastName: true, memberCode: true } }, allocations: true } }),
      ]);
      return {
        page: p, pageSize: 25, total,
        data: rows.map((i) => {
          const paid = i.allocations.reduce((s, a) => s + a.amountPaise, 0);
          return {
            id: i.id, invoiceNumber: i.invoiceNumber, status: i.status, issueDate: i.issueDate && ymd(i.issueDate), memberId: i.memberId,
            memberName: [i.member.firstName, i.member.lastName].filter(Boolean).join(" "), memberCode: i.member.memberCode,
            totalPaise: i.totalPaise, paidPaise: paid, duePaise: i.status === "VOID" ? 0 : i.totalPaise - paid,
          };
        }),
      };
    });
  }

  @Get("invoices/:id")
  @Requires("invoices.read")
  invoice(@CurrentScope() scope: S, @Param("id", ParseUUIDPipe) id: string) {
    return this.db.run(scope, async (tx) => {
      const i = await tx.invoice.findFirst({
        where: { id, ...branchWhere(scope.branchIds) },
        include: {
          items: { orderBy: { sortOrder: "asc" } },
          allocations: { include: { payment: { select: { receiptNumber: true, method: true, receivedAt: true } } } },
          member: { select: { firstName: true, lastName: true, memberCode: true, phone: true } },
          branch: true,
        },
      });
      if (!i) throw notFound("Invoice");
      const business = await tx.business.findFirst();
      const paid = i.allocations.reduce((s, a) => s + a.amountPaise, 0);
      return { ...i, issueDate: i.issueDate && ymd(i.issueDate), dueDate: i.dueDate && ymd(i.dueDate), paidPaise: paid, duePaise: i.totalPaise - paid, business };
    });
  }
}
