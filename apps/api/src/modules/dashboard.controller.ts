import { Controller, Get, Query } from "@nestjs/common";
import { z } from "zod";
import { AuthContext, CurrentAuth, CurrentScope, has, Requires } from "../core/auth";
import { addDays, dbDate, istDate, istDayStart, periodRange } from "../core/dates";
import { branchWhere, Db, Scope } from "../core/db.service";
import type { Permission } from "../core/permissions";
import { Zod, zDate, zUuid } from "../core/validation";

type S = Scope & { permission: Permission };

const q = z.object({
  period: z.enum(["today", "yesterday", "this_week", "this_month", "last_month", "custom"]).default("today"),
  from: zDate.optional(),
  to: zDate.optional(),
  branchId: zUuid.optional(),
});

const auditQ = z.object({
  page: z.coerce.number().int().min(1).default(1),
  action: z.string().max(60).optional(),
  entityType: z.string().max(60).optional(),
  entityId: z.string().max(60).optional(),
  userId: zUuid.optional(),
});

@Controller()
export class DashboardController {
  constructor(private readonly db: Db) {}

  @Get("dashboard")
  @Requires("dashboard.read")
  dashboard(@CurrentScope() scope: S, @CurrentAuth() auth: AuthContext, @Query(new Zod(q)) query: z.infer<typeof q>) {
    const r = periodRange(query.period, query.from, query.to);
    const finance = has(auth, "reports.finance");
    return this.db.run(scope, async (tx) => {
      const b = { ...branchWhere(scope.branchIds), ...(query.branchId ? { branchId: query.branchId } : {}) };
      const mb = { ...branchWhere(scope.branchIds, "homeBranchId"), ...(query.branchId ? { homeBranchId: query.branchId } : {}), deletedAt: null };
      const today = istDate();
      const in7 = addDays(today, 7);

      const dayStart = istDayStart(today);
      const [checkInsToday, insideNow, ptToday] = await Promise.all([
        tx.attendance.count({ where: { ...b, result: "ALLOWED", checkInAt: { gte: dayStart } } }),
        tx.attendance.count({ where: { ...b, result: "ALLOWED", checkOutAt: null, checkInAt: { gte: new Date(Date.now() - 4 * 3600_000) } } }),
        tx.ptSession.count({ where: { ...b, status: { in: ["SCHEDULED", "COMPLETED"] }, scheduledStart: { gte: dayStart, lt: istDayStart(addDays(today, 1)) } } }),
      ]);
      const [byStatus, newRegs, leadsNew, leadsConverted, followUpsDue, dueSoon, lapsed] = await Promise.all([
        tx.member.groupBy({ by: ["status"], where: mb, _count: { _all: true } }),
        tx.member.count({ where: { ...mb, createdAt: { gte: r.start, lt: r.end } } }),
        tx.lead.count({ where: { ...b, deletedAt: null, createdAt: { gte: r.start, lt: r.end } } }),
        tx.lead.count({ where: { ...b, deletedAt: null, convertedAt: { gte: r.start, lt: r.end } } }),
        tx.lead.count({ where: { ...b, deletedAt: null, stage: { notIn: ["CONVERTED", "LOST"] }, nextFollowUpAt: { lte: new Date() } } }),
        tx.subscription.findMany({
          where: { status: "ACTIVE", endDate: { gte: dbDate(today), lte: dbDate(in7) }, next: null, member: mb },
          include: { member: { select: { id: true, firstName: true, lastName: true, memberCode: true } }, plan: { select: { name: true } } },
          orderBy: { endDate: "asc" },
          take: 50,
        }),
        tx.subscription.count({ where: { status: "EXPIRED", endDate: { gte: dbDate(addDays(today, -30)) }, next: null, member: mb } }),
      ]);

      const count = (s: string) => byStatus.find((x) => x.status === s)?._count._all ?? 0;
      const total = byStatus.reduce((s, x) => s + x._count._all, 0);

      let revenue: Record<string, unknown> | undefined;
      let series: { date: string; collectedPaise: number }[] | undefined;
      if (finance) {
        const [collected, dues, byMethod, daily] = await Promise.all([
          tx.payment.aggregate({ where: { ...b, status: "CONFIRMED", receivedAt: { gte: r.start, lt: r.end } }, _sum: { amountPaise: true } }),
          tx.$queryRaw<{ due: bigint | null }[]>`SELECT SUM("duePaise")::bigint AS due FROM invoice_balance WHERE ${query.branchId ?? null}::uuid IS NULL OR "branchId" = ${query.branchId ?? null}::uuid`,
          tx.payment.groupBy({ by: ["method"], where: { ...b, status: "CONFIRMED", receivedAt: { gte: r.start, lt: r.end } }, _sum: { amountPaise: true } }),
          tx.$queryRaw<{ d: string; amt: bigint }[]>`
            SELECT to_char(("receivedAt" AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD') AS d, SUM("amountPaise")::bigint AS amt
            FROM "Payment" WHERE status = 'CONFIRMED' AND "receivedAt" >= ${istDayStart(addDays(today, -29))}
              AND (${query.branchId ?? null}::uuid IS NULL OR "branchId" = ${query.branchId ?? null}::uuid)
            GROUP BY 1 ORDER BY 1`,
        ]);
        revenue = {
          collectedPaise: collected._sum.amountPaise ?? 0,
          duesPaise: Number(dues[0]?.due ?? 0),
          byMethod: Object.fromEntries(byMethod.map((m) => [m.method, m._sum.amountPaise ?? 0])),
        };
        const map = new Map(daily.map((x) => [x.d, Number(x.amt)]));
        series = Array.from({ length: 30 }, (_, i) => {
          const d = addDays(today, i - 29);
          return { date: d, collectedPaise: map.get(d) ?? 0 };
        });
      }

      return {
        period: { from: r.fromDate, to: r.toDate },
        today: { checkIns: checkInsToday, insideNow, ptSessions: ptToday },
        members: { total, active: count("ACTIVE"), expired: count("EXPIRED"), frozen: count("FROZEN"), prospects: count("PROSPECT"), newRegistrations: newRegs },
        leads: { new: leadsNew, converted: leadsConverted, followUpsDue, conversionRateBp: leadsNew ? Math.round((leadsConverted / leadsNew) * 10000) : 0 },
        renewals: {
          dueNext7Days: dueSoon.length,
          expiredLast30DaysNotRenewed: lapsed,
          upcoming: dueSoon.slice(0, 8).map((s) => ({
            subscriptionId: s.id, memberId: s.member.id, memberCode: s.member.memberCode,
            memberName: [s.member.firstName, s.member.lastName].filter(Boolean).join(" "), planName: s.plan.name,
            endDate: s.endDate.toISOString().slice(0, 10),
          })),
        },
        revenue,
        revenueSeries: series,
      };
    });
  }

  @Get("audit-logs")
  @Requires("audit.read")
  async audit(@CurrentScope() scope: S, @Query(new Zod(auditQ)) query: z.infer<typeof auditQ>) {
    const where = {
      ...(scope.branchIds === "*" ? {} : { branchId: { in: scope.branchIds } }),
      ...(query.action ? { action: { startsWith: query.action } } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
    };
    const [total, rows] = await Promise.all([
      this.db.raw.auditLog.count({ where }),
      this.db.raw.auditLog.findMany({ where, orderBy: { id: "desc" }, skip: (query.page - 1) * 50, take: 50, include: { user: { select: { displayName: true } } } }),
    ]);
    return {
      page: query.page, pageSize: 50, total,
      data: rows.map((a) => ({ ...a, id: Number(a.id), userName: a.user?.displayName ?? null, user: undefined })),
    };
  }
}
