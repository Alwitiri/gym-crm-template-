import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { AuditService } from "../core/audit.service";
import { CurrentScope, Requires } from "../core/auth";
import { addDays, dbDate, istDate, istDayStart, ymd } from "../core/dates";
import { branchWhere, Db, inScope, Scope } from "../core/db.service";
import { forbidden, notFound } from "../core/errors";
import type { Permission } from "../core/permissions";
import { Zod, zDate, zPaise, zUuid } from "../core/validation";

type S = Scope & { permission: Permission };

const expenseBody = z.object({
  branchId: zUuid, categoryId: zUuid, description: z.string().trim().min(2).max(200), amountPaise: zPaise.refine((v) => v > 0, "Enter an amount"),
  gstPaise: zPaise.default(0), expenseDate: zDate, paymentMethod: z.enum(["CASH", "UPI", "CARD", "BANK_TRANSFER"]), referenceNumber: z.string().trim().max(60).optional(),
});
const range = z.object({ from: zDate.optional(), to: zDate.optional(), branchId: zUuid.optional() });
const monthStart = (ymdStr: string) => ymdStr.slice(0, 8) + "01";

function resolveRange(q: { from?: string; to?: string }) {
  const today = istDate();
  const from = q.from ?? monthStart(today);
  const to = q.to ?? today;
  return { from, to, start: istDayStart(from), end: istDayStart(addDays(to, 1)) };
}

@Controller()
export class FinanceController {
  constructor(private readonly db: Db, private readonly audit: AuditService) {}

  // ---------------- Expenses ----------------
  @Get("expense-categories")
  @Requires("expenses.read", "expenses.manage")
  categories() {
    return this.db.raw.expenseCategory.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" } });
  }

  @Get("expenses")
  @Requires("expenses.read")
  list(@CurrentScope() scope: S, @Query(new Zod(range)) q: z.infer<typeof range>) {
    const r = resolveRange(q);
    return this.db.run(scope, async (tx) => {
      const rows = await tx.expense.findMany({
        where: { deletedAt: null, ...branchWhere(scope.branchIds), ...(q.branchId ? { branchId: q.branchId } : {}), expenseDate: { gte: dbDate(r.from), lte: dbDate(r.to) } },
        include: { category: true, branch: { select: { name: true } }, createdBy: { select: { displayName: true } } },
        orderBy: [{ expenseDate: "desc" }, { createdAt: "desc" }],
        take: 1000,
      });
      const byCategory: Record<string, number> = {};
      for (const e of rows) byCategory[e.category.name] = (byCategory[e.category.name] ?? 0) + e.amountPaise;
      return {
        from: r.from, to: r.to, totalPaise: rows.reduce((s, e) => s + e.amountPaise, 0), byCategory,
        data: rows.map((e) => ({
          id: e.id, expenseDate: ymd(e.expenseDate), category: e.category.name, categoryId: e.categoryId, description: e.description, amountPaise: e.amountPaise,
          gstPaise: e.gstPaise, paymentMethod: e.paymentMethod, referenceNumber: e.referenceNumber, branchId: e.branchId, branchName: e.branch.name, createdByName: e.createdBy.displayName,
        })),
      };
    });
  }

  @Post("expenses")
  @Requires("expenses.manage")
  create(@CurrentScope() scope: S, @Body(new Zod(expenseBody)) b: z.infer<typeof expenseBody>) {
    if (!inScope(scope.branchIds, b.branchId)) throw forbidden("You can't add expenses for that branch");
    if (b.expenseDate > istDate()) throw forbidden("Expenses can't be dated in the future");
    return this.db.run(scope, async (tx) => {
      const e = await tx.expense.create({ data: { ...b, expenseDate: dbDate(b.expenseDate), createdById: scope.userId } });
      await this.audit.log(tx, { userId: scope.userId, branchId: b.branchId, action: "expense.create", entityType: "Expense", entityId: e.id, after: b });
      return e;
    });
  }

  @Delete("expenses/:id")
  @HttpCode(204)
  @Requires("expenses.manage")
  remove(@CurrentScope() scope: S, @Param("id", ParseUUIDPipe) id: string) {
    return this.db.run(scope, async (tx) => {
      const e = await tx.expense.findFirst({ where: { id, deletedAt: null, ...branchWhere(scope.branchIds) } });
      if (!e) throw notFound("Expense");
      await tx.expense.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit.log(tx, { userId: scope.userId, branchId: e.branchId, action: "expense.delete", entityType: "Expense", entityId: id, before: e });
    });
  }

  // ---------------- Reports ----------------
  /** Profit and loss: money received vs expenses, plus a 6-month trend. */
  @Get("reports/profit")
  @Requires("reports.finance")
  profit(@CurrentScope() scope: S, @Query(new Zod(range)) q: z.infer<typeof range>) {
    const r = resolveRange(q);
    const b = { ...branchWhere(scope.branchIds), ...(q.branchId ? { branchId: q.branchId } : {}) };
    return this.db.run(scope, async (tx) => {
      const [income, byMethod, expenses, expCats] = await Promise.all([
        tx.payment.aggregate({ where: { ...b, status: "CONFIRMED", receivedAt: { gte: r.start, lt: r.end } }, _sum: { amountPaise: true }, _count: true }),
        tx.payment.groupBy({ by: ["method"], where: { ...b, status: "CONFIRMED", receivedAt: { gte: r.start, lt: r.end } }, _sum: { amountPaise: true } }),
        tx.expense.aggregate({ where: { ...b, deletedAt: null, expenseDate: { gte: dbDate(r.from), lte: dbDate(r.to) } }, _sum: { amountPaise: true } }),
        tx.expense.groupBy({ by: ["categoryId"], where: { ...b, deletedAt: null, expenseDate: { gte: dbDate(r.from), lte: dbDate(r.to) } }, _sum: { amountPaise: true } }),
      ]);
      const cats = await tx.expenseCategory.findMany();
      const months: { month: string; incomePaise: number; expensesPaise: number }[] = [];
      const thisMonth = monthStart(istDate());
      for (let i = 5; i >= 0; i--) {
        const d = new Date(thisMonth + "T00:00:00Z"); d.setUTCMonth(d.getUTCMonth() - i);
        const mStart = d.toISOString().slice(0, 10);
        const next = new Date(d); next.setUTCMonth(next.getUTCMonth() + 1);
        const mEnd = next.toISOString().slice(0, 10);
        const [inc, exp] = await Promise.all([
          tx.payment.aggregate({ where: { ...b, status: "CONFIRMED", receivedAt: { gte: istDayStart(mStart), lt: istDayStart(mEnd) } }, _sum: { amountPaise: true } }),
          tx.expense.aggregate({ where: { ...b, deletedAt: null, expenseDate: { gte: dbDate(mStart), lt: dbDate(mEnd) } }, _sum: { amountPaise: true } }),
        ]);
        months.push({ month: mStart.slice(0, 7), incomePaise: inc._sum.amountPaise ?? 0, expensesPaise: exp._sum.amountPaise ?? 0 });
      }
      const inc = income._sum.amountPaise ?? 0, exp = expenses._sum.amountPaise ?? 0;
      return {
        from: r.from, to: r.to, incomePaise: inc, payments: income._count, expensesPaise: exp, netPaise: inc - exp,
        incomeByMethod: Object.fromEntries(byMethod.map((m) => [m.method, m._sum.amountPaise ?? 0])),
        expensesByCategory: expCats.map((c) => ({ category: cats.find((x) => x.id === c.categoryId)?.name ?? "Other", amountPaise: c._sum.amountPaise ?? 0 })).sort((a, b2) => b2.amountPaise - a.amountPaise),
        months,
      };
    });
  }

  /** GST summary for the accountant: every invoice issued in the period, with tax split. */
  @Get("reports/gst")
  @Requires("reports.finance")
  gst(@CurrentScope() scope: S, @Query(new Zod(range)) q: z.infer<typeof range>) {
    const r = resolveRange(q);
    return this.db.run(scope, async (tx) => {
      const rows = await tx.invoice.findMany({
        where: { ...branchWhere(scope.branchIds), ...(q.branchId ? { branchId: q.branchId } : {}), status: { in: ["ISSUED", "PARTIALLY_PAID", "PAID", "VOID"] }, issueDate: { gte: dbDate(r.from), lte: dbDate(r.to) } },
        include: { member: { select: { firstName: true, lastName: true, memberCode: true } }, branch: { select: { name: true, gstin: true } }, items: { select: { sacOrHsn: true, taxRateBp: true } } },
        orderBy: [{ issueDate: "asc" }, { invoiceNumber: "asc" }],
      });
      const live = rows.filter((i) => i.status !== "VOID");
      const sum = (k: "subtotalPaise" | "cgstPaise" | "sgstPaise" | "igstPaise" | "totalPaise") => live.reduce((s, i) => s + i[k], 0);
      return {
        from: r.from, to: r.to,
        totals: { invoices: live.length, voided: rows.length - live.length, taxablePaise: sum("subtotalPaise"), cgstPaise: sum("cgstPaise"), sgstPaise: sum("sgstPaise"), igstPaise: sum("igstPaise"), totalPaise: sum("totalPaise") },
        data: rows.map((i) => ({
          invoiceNumber: i.invoiceNumber, issueDate: i.issueDate && ymd(i.issueDate), status: i.status, branch: i.branch.name,
          customer: [i.member.firstName, i.member.lastName].filter(Boolean).join(" "), memberCode: i.member.memberCode, placeOfSupply: i.placeOfSupplyStateCode,
          sac: [...new Set(i.items.map((x) => x.sacOrHsn).filter(Boolean))].join(" "), taxRate: Math.max(0, ...i.items.map((x) => x.taxRateBp)) / 100,
          taxablePaise: i.subtotalPaise, cgstPaise: i.cgstPaise, sgstPaise: i.sgstPaise, igstPaise: i.igstPaise, totalPaise: i.totalPaise,
        })),
      };
    });
  }

  /** Renewals: of the memberships that ended in the period, how many renewed. */
  @Get("reports/renewals")
  @Requires("reports.read", "reports.finance")
  renewals(@CurrentScope() scope: S, @Query(new Zod(range)) q: z.infer<typeof range>) {
    const r = resolveRange(q);
    return this.db.run(scope, async (tx) => {
      const subs = await tx.subscription.findMany({
        where: { endDate: { gte: dbDate(r.from), lte: dbDate(r.to) }, status: { notIn: ["CANCELLED", "PENDING_PAYMENT"] }, member: { deletedAt: null, ...branchWhere(scope.branchIds, "homeBranchId"), ...(q.branchId ? { homeBranchId: q.branchId } : {}) } },
        include: { next: { select: { id: true, status: true, startDate: true } }, plan: { select: { name: true } }, member: { select: { id: true, firstName: true, lastName: true, memberCode: true, phone: true } } },
        orderBy: { endDate: "asc" },
      });
      const today = istDate();
      const data = subs.map((s) => ({
        memberId: s.member.id, memberName: [s.member.firstName, s.member.lastName].filter(Boolean).join(" "), memberCode: s.member.memberCode, phone: s.member.phone,
        planName: s.plan.name, endDate: ymd(s.endDate),
        outcome: s.next && s.next.status !== "PENDING_PAYMENT" ? "RENEWED" : ymd(s.endDate) >= today ? "DUE" : "LAPSED",
      }));
      const ended = data.filter((d) => d.outcome !== "DUE");
      const renewed = ended.filter((d) => d.outcome === "RENEWED").length;
      return { from: r.from, to: r.to, endedInPeriod: ended.length, renewed, lapsed: ended.length - renewed, stillDue: data.length - ended.length, renewalRatePct: ended.length ? Math.round((renewed / ended.length) * 100) : null, data };
    });
  }

  /** Leads by source: how many came in and how many joined. */
  @Get("reports/leads")
  @Requires("reports.read", "reports.finance")
  leads(@CurrentScope() scope: S, @Query(new Zod(range)) q: z.infer<typeof range>) {
    const r = resolveRange(q);
    return this.db.run(scope, async (tx) => {
      const rows = await tx.lead.findMany({
        where: { deletedAt: null, ...branchWhere(scope.branchIds), ...(q.branchId ? { branchId: q.branchId } : {}), createdAt: { gte: r.start, lt: r.end } },
        select: { source: true, stage: true, lostReason: true },
      });
      const bySource = new Map<string, { source: string; leads: number; joined: number; lost: number; open: number }>();
      const lostReasons = new Map<string, number>();
      for (const l of rows) {
        const e = bySource.get(l.source) ?? { source: l.source, leads: 0, joined: 0, lost: 0, open: 0 };
        e.leads++;
        if (l.stage === "CONVERTED") e.joined++; else if (l.stage === "LOST") e.lost++; else e.open++;
        bySource.set(l.source, e);
        if (l.stage === "LOST" && l.lostReason) lostReasons.set(l.lostReason, (lostReasons.get(l.lostReason) ?? 0) + 1);
      }
      const data = [...bySource.values()].map((e) => ({ ...e, conversionPct: e.leads ? Math.round((e.joined / e.leads) * 100) : 0 })).sort((a, b) => b.leads - a.leads);
      return {
        from: r.from, to: r.to, totals: { leads: rows.length, joined: data.reduce((s, d) => s + d.joined, 0) },
        data, lostReasons: [...lostReasons.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count).slice(0, 8),
      };
    });
  }

  /** Trainers: members looked after, PT sessions delivered and PT revenue. */
  @Get("reports/trainers")
  @Requires("reports.read", "reports.finance")
  trainers(@CurrentScope() scope: S, @Query(new Zod(range)) q: z.infer<typeof range>) {
    const r = resolveRange(q);
    return this.db.run(scope, async (tx) => {
      const staff = await tx.staff.findMany({
        where: { isTrainer: true, ...branchWhere(scope.branchIds), ...(q.branchId ? { branchId: q.branchId } : {}) },
        include: { user: { select: { displayName: true } }, branch: { select: { name: true } }, _count: { select: { assignments: { where: { endedAt: null } } } } },
      });
      const ids = staff.map((s) => s.id);
      const [sessions, sold] = await Promise.all([
        tx.ptSession.groupBy({ by: ["trainerId", "status"], where: { trainerId: { in: ids }, scheduledStart: { gte: r.start, lt: r.end } }, _count: { _all: true } }),
        tx.memberPtPackage.findMany({ where: { trainerId: { in: ids }, createdAt: { gte: r.start, lt: r.end }, invoice: { status: { not: "VOID" } } }, include: { invoice: { select: { subtotalPaise: true } } } }),
      ]);
      const count = (id: string, st: string[]) => sessions.filter((s) => s.trainerId === id && st.includes(s.status)).reduce((a, s) => a + s._count._all, 0);
      return {
        from: r.from, to: r.to,
        data: staff.map((t) => ({
          trainerId: t.id, name: t.user.displayName, branch: t.branch.name, status: t.employmentStatus, activeMembers: t._count.assignments,
          ptCompleted: count(t.id, ["COMPLETED"]), ptNoShows: count(t.id, ["NO_SHOW"]), ptCancelled: count(t.id, ["CANCELLED_BY_MEMBER", "CANCELLED_BY_TRAINER"]),
          ptPackagesSold: sold.filter((p) => p.trainerId === t.id).length,
          ptRevenuePaise: sold.filter((p) => p.trainerId === t.id).reduce((s, p) => s + (p.invoice?.subtotalPaise ?? 0), 0),
        })).sort((a, b) => b.ptRevenuePaise - a.ptRevenuePaise),
      };
    });
  }
}
