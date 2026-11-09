import { Injectable } from "@nestjs/common";
import { AuditService } from "../core/audit.service";
import { MessagingService } from "./messaging.service";
import { addDays, dbDate, financialYear, istDate, ymd } from "../core/dates";
import type { Tx } from "../core/db.service";
import { forbidden, notFound, unprocessable } from "../core/errors";

export interface QuoteLine {
  itemType: "MEMBERSHIP" | "REGISTRATION_FEE" | "PT_PACKAGE";
  description: string;
  sacOrHsn: string | null;
  quantity: number;
  unitPricePaise: number;
  discountPaise: number;
  taxableValuePaise: number;
  taxRateBp: number;
  taxPaise: number;
  totalPaise: number;
}

export interface InvoiceQuote {
  items: QuoteLine[];
  subtotalPaise: number;
  discountPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  roundOffPaise: number;
  totalPaise: number;
  placeOfSupplyStateCode: string;
  branchId: string;
}

export interface MembershipQuote {
  planId: string;
  planName: string;
  startDate: string;
  endDate: string;
  items: QuoteLine[];
  subtotalPaise: number;
  discountPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  roundOffPaise: number;
  totalPaise: number;
  placeOfSupplyStateCode: string;
}

export interface OfflinePayment {
  method: "CASH" | "UPI" | "CARD" | "BANK_TRANSFER";
  amountPaise: number;
  referenceNumber?: string;
}

const LIVE = ["ACTIVE", "SCHEDULED", "FROZEN"] as const;

/** Half-up rounding of tax in paise. */
const taxOf = (taxable: number, rateBp: number) => Math.floor((taxable * rateBp + 5000) / 10000);

/** Totals for B2C intra-state supply: CGST + SGST split, rounded to the rupee. */
export function totals(items: QuoteLine[]) {
  const subtotal = items.reduce((s, i) => s + i.taxableValuePaise, 0);
  const tax = items.reduce((s, i) => s + i.taxPaise, 0);
  const cgst = Math.floor(tax / 2);
  const beforeRound = subtotal + tax;
  const roundOff = Math.round(beforeRound / 100) * 100 - beforeRound;
  return { subtotalPaise: subtotal, discountPaise: 0, cgstPaise: cgst, sgstPaise: tax - cgst, igstPaise: 0, roundOffPaise: roundOff, totalPaise: beforeRound + roundOff };
}

export function line(itemType: QuoteLine["itemType"], description: string, sac: string, unit: number, discount: number, rateBp: number): QuoteLine {
  const taxable = unit - discount;
  const tax = taxOf(taxable, rateBp);
  return {
    itemType, description, sacOrHsn: sac, quantity: 1, unitPricePaise: unit, discountPaise: discount,
    taxableValuePaise: taxable, taxRateBp: rateBp, taxPaise: tax, totalPaise: taxable + tax,
  };
}

@Injectable()
export class BillingService {
  constructor(private readonly audit: AuditService, readonly messaging: MessagingService) {}

  /** Prices a membership exactly the way the invoice will be built. Pure read. */
  async quoteMembership(
    tx: Tx,
    input: { memberId: string; planId: string; startDate?: string; discountPaise?: number; waiveRegistrationFee?: boolean },
    caps: { unlimitedDiscount: boolean; canBackdate: boolean },
  ): Promise<MembershipQuote & { branchId: string }> {
    const member = await tx.member.findFirst({ where: { id: input.memberId, deletedAt: null }, include: { homeBranch: true } });
    if (!member) throw notFound("Member");
    const plan = await tx.membershipPlan.findFirst({ where: { id: input.planId, status: "ACTIVE" }, include: { branches: true } });
    if (!plan) throw notFound("Plan");
    if (!plan.allBranchAccess && !plan.branches.some((b) => b.branchId === member.homeBranchId)) {
      throw unprocessable("PLAN_NOT_AT_BRANCH", `${plan.name} is not sold at ${member.homeBranch.name}`);
    }

    // Start date: renewal policy START_AFTER_CURRENT_END — never overlap a live membership.
    const today = istDate();
    const latest = await tx.subscription.findFirst({
      where: { memberId: member.id, status: { in: [...LIVE] } },
      orderBy: { endDate: "desc" },
    });
    const earliest = latest ? addDays(ymd(latest.endDate), 1) : today;
    let start = earliest > today ? earliest : today;
    if (input.startDate) {
      if (input.startDate < today && !caps.canBackdate) throw forbidden("You can't start a membership in the past");
      if (latest && input.startDate < earliest) {
        throw unprocessable("SUBSCRIPTION_OVERLAP", `Current membership runs until ${ymd(latest.endDate)}. The new one can start from ${earliest}.`);
      }
      start = input.startDate;
    }
    const end = addDays(start, plan.durationDays - 1);

    const discount = input.discountPaise ?? 0;
    if (discount > plan.pricePaise) throw unprocessable("DISCOUNT_TOO_LARGE", "Discount is more than the plan price");
    if (discount > plan.maxDiscountPaise && !caps.unlimitedDiscount) {
      throw forbidden(`Maximum discount you can give on ${plan.name} is ₹${(plan.maxDiscountPaise / 100).toFixed(0)}`);
    }

    const items: QuoteLine[] = [line("MEMBERSHIP", `${plan.name} membership (${start} to ${end})`, plan.sacCode, plan.pricePaise, discount, plan.taxRateBp)];
    const isFirstPurchase = (await tx.subscription.count({ where: { memberId: member.id, status: { not: "CANCELLED" } } })) === 0;
    if (plan.registrationFeePaise > 0 && isFirstPurchase && !input.waiveRegistrationFee) {
      items.push(line("REGISTRATION_FEE", "Registration fee", plan.sacCode, plan.registrationFeePaise, 0, plan.taxRateBp));
    }

    const subtotal = items.reduce((s, i) => s + i.taxableValuePaise, 0);
    const tax = items.reduce((s, i) => s + i.taxPaise, 0);
    // B2C service at the branch: place of supply is the branch's state → intra-state CGST + SGST.
    const cgst = Math.floor(tax / 2);
    const sgst = tax - cgst;
    const beforeRound = subtotal + tax;
    const roundOff = Math.round(beforeRound / 100) * 100 - beforeRound;

    return {
      planId: plan.id, planName: plan.name, startDate: start, endDate: end, items,
      subtotalPaise: subtotal, discountPaise: 0, cgstPaise: cgst, sgstPaise: sgst, igstPaise: 0,
      roundOffPaise: roundOff, totalPaise: beforeRound + roundOff,
      placeOfSupplyStateCode: member.homeBranch.stateCode,
      branchId: member.homeBranchId,
    };
  }

  /** Creates the pending subscription + issued invoice (+ payment) in the caller's transaction. */
  async sellMembership(
    tx: Tx,
    userId: string,
    memberId: string,
    quote: MembershipQuote & { branchId: string },
    payment: OfflinePayment | undefined,
  ) {
    const plan = await tx.membershipPlan.findUniqueOrThrow({ where: { id: quote.planId } });
    const latest = await tx.subscription.findFirst({
      where: { memberId, status: { in: [...LIVE] } },
      orderBy: { endDate: "desc" },
      select: { id: true },
    });

    const invoice = await this.issueInvoice(tx, userId, memberId, quote);
    const subscription = await tx.subscription.create({
      data: {
        memberId,
        planId: plan.id,
        invoiceId: invoice.id,
        previousSubscriptionId: latest?.id,
        status: "PENDING_PAYMENT",
        startDate: dbDate(quote.startDate),
        endDate: dbDate(quote.endDate),
        originalEndDate: dbDate(quote.endDate),
        planSnapshot: {
          name: plan.name, durationDays: plan.durationDays, pricePaise: plan.pricePaise, taxRateBp: plan.taxRateBp,
          freezeAllowed: plan.freezeAllowed, maxFreezeDays: plan.maxFreezeDays, maxFreezeCount: plan.maxFreezeCount,
          allBranchAccess: plan.allBranchAccess, accessStartTime: plan.accessStartTime, accessEndTime: plan.accessEndTime,
          facilities: plan.facilities,
        },
      },
    });
    await this.audit.log(tx, {
      userId, branchId: quote.branchId, action: "subscription.sell", entityType: "Subscription", entityId: subscription.id,
      after: { planId: plan.id, startDate: quote.startDate, endDate: quote.endDate, invoiceId: invoice.id, totalPaise: quote.totalPaise },
    });

    let paymentRow = null;
    if (payment) paymentRow = await this.recordPayment(tx, userId, memberId, quote.branchId, payment, [{ invoiceId: invoice.id, amountPaise: Math.min(payment.amountPaise, invoice.totalPaise) }]);

    const sub = await tx.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
    const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoice.id }, include: { items: true } });
    return { subscription: sub, invoice: inv, payment: paymentRow };
  }

  async issueInvoice(tx: Tx, userId: string, memberId: string, q: InvoiceQuote) {
    const today = istDate();
    const fy = financialYear(today);
    const branch = await tx.branch.findUniqueOrThrow({ where: { id: q.branchId } });

    // Draft first (items may only be added to drafts), then issue with the next GST number.
    const draft = await tx.invoice.create({
      data: {
        branchId: q.branchId, memberId, status: "DRAFT", placeOfSupplyStateCode: q.placeOfSupplyStateCode,
        subtotalPaise: q.subtotalPaise, discountPaise: q.discountPaise, cgstPaise: q.cgstPaise, sgstPaise: q.sgstPaise,
        igstPaise: q.igstPaise, roundOffPaise: q.roundOffPaise, totalPaise: q.totalPaise, createdById: userId,
        items: { create: q.items.map((i, idx) => ({ ...i, sortOrder: idx })) },
      },
    });
    await tx.$executeRaw`INSERT INTO "InvoiceSequence" ("branchId", "financialYear", "prefix", "nextNumber")
      VALUES (${branch.id}::uuid, ${fy}, ${branch.code.replace(/-/g, "") + "/" + fy.slice(2) + "/"}, 1)
      ON CONFLICT DO NOTHING`;
    const [{ n }] = await tx.$queryRaw<{ n: string }[]>`SELECT next_invoice_number(${branch.id}::uuid, ${fy}) AS n`;
    const issued = await tx.invoice.update({
      where: { id: draft.id },
      data: { status: "ISSUED", invoiceNumber: n, issueDate: dbDate(today), dueDate: dbDate(today) },
    });
    await this.audit.log(tx, {
      userId, branchId: q.branchId, action: "invoice.issue", entityType: "Invoice", entityId: issued.id,
      after: { invoiceNumber: n, totalPaise: issued.totalPaise },
    });
    return issued;
  }

  /** Records a confirmed offline payment, allocates it, then settles invoices and activates what they paid for. */
  async recordPayment(
    tx: Tx,
    userId: string,
    memberId: string,
    branchId: string,
    p: OfflinePayment,
    allocations: { invoiceId: string; amountPaise: number }[],
  ) {
    if (p.method !== "CASH" && !p.referenceNumber) {
      throw unprocessable("REFERENCE_REQUIRED", "Enter the UPI / card / bank reference number");
    }
    const allocated = allocations.reduce((s, a) => s + a.amountPaise, 0);
    if (allocated > p.amountPaise) throw unprocessable("ALLOCATION_TOO_LARGE", "Allocated more than the amount received");

    const [{ n }] = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('receipt_no_seq') AS n`;
    const branch = await tx.branch.findUniqueOrThrow({ where: { id: branchId }, select: { code: true } });
    const payment = await tx.payment.create({
      data: {
        receiptNumber: `RC-${branch.code}-${String(n).padStart(6, "0")}`,
        branchId, memberId, method: p.method, status: "CONFIRMED", amountPaise: p.amountPaise,
        unallocatedPaise: p.amountPaise - allocated, referenceNumber: p.referenceNumber, receivedById: userId,
        receivedAt: new Date(),
      },
    });
    for (const a of allocations) {
      if (a.amountPaise <= 0) continue;
      const inv = await tx.invoice.findFirst({ where: { id: a.invoiceId, memberId } });
      if (!inv) throw notFound("Invoice");
      await tx.paymentAllocation.create({ data: { paymentId: payment.id, invoiceId: a.invoiceId, amountPaise: a.amountPaise } });
      await this.settleInvoice(tx, a.invoiceId);
    }
    await this.audit.log(tx, {
      userId, branchId, action: "payment.record", entityType: "Payment", entityId: payment.id,
      after: { method: p.method, amountPaise: p.amountPaise, allocations },
    });
    const m = await tx.member.findUniqueOrThrow({ where: { id: memberId }, select: { firstName: true, phone: true } });
    await this.messaging.queue(tx, { key: "payment.receipt", memberId, phone: m.phone, dedupeKey: `rcpt:${payment.id}`, vars: this.messaging.receiptVars(m.firstName, p.amountPaise, payment.receiptNumber) });
    return payment;
  }

  /** Updates invoice status from its allocations; activates the linked subscription once fully paid. */
  async settleInvoice(tx: Tx, invoiceId: string) {
    const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { allocations: true, subscription: true, ptPackage: true } });
    const paid = inv.allocations.reduce((s, a) => s + a.amountPaise, 0);
    const status = paid >= inv.totalPaise ? "PAID" : paid > 0 ? "PARTIALLY_PAID" : "ISSUED";
    if (status !== inv.status) await tx.invoice.update({ where: { id: inv.id }, data: { status } });

    const sub = inv.subscription;
    if (status === "PAID" && sub && sub.status === "PENDING_PAYMENT") {
      const today = istDate();
      const started = ymd(sub.startDate) <= today;
      await tx.subscription.update({
        where: { id: sub.id },
        data: { status: started ? "ACTIVE" : "SCHEDULED", activatedAt: new Date() },
      });
      await this.refreshMemberStatus(tx, sub.memberId);
    }
    if (status === "PAID" && inv.ptPackage && inv.ptPackage.status === "PENDING_PAYMENT") {
      await tx.memberPtPackage.update({ where: { id: inv.ptPackage.id }, data: { status: "ACTIVE" } });
    }
  }

  /** Recomputes the denormalised Member.status from subscriptions. */
  async refreshMemberStatus(tx: Tx, memberId: string) {
    const today = dbDate(istDate());
    const subs = await tx.subscription.findMany({ where: { memberId, status: { not: "CANCELLED" } }, orderBy: { endDate: "desc" } });
    let status: "ACTIVE" | "EXPIRED" | "FROZEN" | "PROSPECT" = "PROSPECT";
    if (subs.some((s) => s.status === "FROZEN")) status = "FROZEN";
    else if (subs.some((s) => s.status === "ACTIVE" && s.startDate <= today && s.endDate >= today)) status = "ACTIVE";
    else if (subs.some((s) => ["ACTIVE", "EXPIRED"].includes(s.status))) status = "EXPIRED";
    await tx.member.update({ where: { id: memberId }, data: { status } });
  }
}
