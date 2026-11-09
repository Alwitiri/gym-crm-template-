import { Body, Controller, Get, Headers, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { CurrentScope, Requires } from "../core/auth";
import { periodRange } from "../core/dates";
import { branchWhere, Db, Scope } from "../core/db.service";
import { notFound, unprocessable } from "../core/errors";
import { Idempotency } from "../core/idempotency.service";
import type { Permission } from "../core/permissions";
import { Zod, zDate, zUuid } from "../core/validation";
import { BillingService } from "./billing.service";
import { paymentInput } from "./members.controller";

type S = Scope & { permission: Permission };

const recordBody = paymentInput.extend({
  memberId: zUuid,
  allocations: z.array(z.object({ invoiceId: zUuid, amountPaise: z.number().int().min(1) })).default([]),
});

const listQ = z.object({
  period: z.enum(["today", "yesterday", "this_week", "this_month", "last_month", "custom"]).default("today"),
  from: zDate.optional(),
  to: zDate.optional(),
  branchId: zUuid.optional(),
  method: z.enum(["CASH", "UPI", "CARD", "BANK_TRANSFER", "GATEWAY"]).optional(),
});

@Controller("payments")
export class PaymentsController {
  constructor(private readonly db: Db, private readonly billing: BillingService, private readonly idem: Idempotency) {}

  @Get()
  @Requires("payments.read")
  list(@CurrentScope() scope: S, @Query(new Zod(listQ)) q: z.infer<typeof listQ>) {
    const r = periodRange(q.period, q.from, q.to);
    return this.db.run(scope, async (tx) => {
      const rows = await tx.payment.findMany({
        where: {
          status: "CONFIRMED", receivedAt: { gte: r.start, lt: r.end }, ...branchWhere(scope.branchIds),
          ...(q.branchId ? { branchId: q.branchId } : {}), ...(q.method ? { method: q.method } : {}),
        },
        orderBy: { receivedAt: "desc" },
        take: 500,
        include: { receivedBy: { select: { displayName: true } }, allocations: { include: { invoice: { select: { invoiceNumber: true } } } } },
      });
      const members = await tx.member.findMany({ where: { id: { in: [...new Set(rows.map((p) => p.memberId))] } }, select: { id: true, firstName: true, lastName: true, memberCode: true } });
      const byId = new Map(members.map((m) => [m.id, m]));
      const totalsByMethod: Record<string, number> = {};
      for (const p of rows) totalsByMethod[p.method] = (totalsByMethod[p.method] ?? 0) + p.amountPaise;
      return {
        from: r.fromDate, to: r.toDate, totalPaise: rows.reduce((s, p) => s + p.amountPaise, 0), totalsByMethod,
        data: rows.map((p) => {
          const m = byId.get(p.memberId);
          return {
            id: p.id, receiptNumber: p.receiptNumber, method: p.method, amountPaise: p.amountPaise, unallocatedPaise: p.unallocatedPaise,
            referenceNumber: p.referenceNumber, receivedAt: p.receivedAt, receivedByName: p.receivedBy?.displayName,
            memberId: p.memberId, memberName: m ? [m.firstName, m.lastName].filter(Boolean).join(" ") : null, memberCode: m?.memberCode,
            invoices: p.allocations.map((a) => a.invoice.invoiceNumber),
          };
        }),
      };
    });
  }

  /** Collect money against dues (partial payments, balance of an earlier sale, or advance credit). */
  @Post()
  @Requires("payments.collect")
  record(@CurrentScope() scope: S, @Headers("idempotency-key") key: string | undefined, @Body(new Zod(recordBody)) body: z.infer<typeof recordBody>) {
    return this.idem.run(scope.userId, key, "POST /payments", body, () =>
      this.db.run(scope, async (tx) => {
        const member = await tx.member.findFirst({ where: { id: body.memberId, deletedAt: null, ...branchWhere(scope.branchIds, "homeBranchId") } });
        if (!member) throw notFound("Member");
        // Default allocation: oldest dues first.
        let allocations = body.allocations;
        if (allocations.length === 0) {
          const dues = await tx.$queryRaw<{ invoiceId: string; duePaise: number }[]>`
            SELECT b."invoiceId", b."duePaise" FROM invoice_balance b JOIN "Invoice" i ON i.id = b."invoiceId"
            WHERE b."memberId" = ${member.id}::uuid AND b."duePaise" > 0 ORDER BY i."issueDate", i."createdAt"`;
          let left = body.amountPaise;
          allocations = [];
          for (const d of dues) {
            if (left <= 0) break;
            const a = Math.min(left, Number(d.duePaise));
            allocations.push({ invoiceId: d.invoiceId, amountPaise: a });
            left -= a;
          }
        }
        if (allocations.length === 0) throw unprocessable("NOTHING_DUE", "This member has no dues to pay");
        const p = await this.billing.recordPayment(tx, scope.userId, member.id, member.homeBranchId, body, allocations);
        return { ...p, allocations };
      }),
    );
  }
}
