import { Body, Controller, Get, Headers, HttpCode, Injectable, Logger, Param, ParseUUIDPipe, Post, Req } from "@nestjs/common";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { AuditService } from "../core/audit.service";
import { CurrentScope, Public, Requires } from "../core/auth";
import { config } from "../core/config";
import { branchWhere, Db, Scope, Tx } from "../core/db.service";
import { AppError, notFound, unprocessable } from "../core/errors";
import type { Permission } from "../core/permissions";
import { SettingsService } from "../core/settings.service";
import { BillingService } from "./billing.service";
import { MessagingService } from "./messaging.service";

type S = Scope & { permission: Permission };
const SYSTEM = "00000000-0000-0000-0000-000000000000";
const LINK_DAYS = 7;

export type Provider = "razorpay" | "simulator";
export function paymentProvider(): Provider | null {
  if (config.razorpay.keyId && config.razorpay.keySecret) return "razorpay";
  if (config.paymentsSimulator) return "simulator";
  return null;
}

const rzpAuth = () => "Basic " + Buffer.from(`${config.razorpay.keyId}:${config.razorpay.keySecret}`).toString("base64");

@Injectable()
export class OnlinePayments {
  private readonly log = new Logger("OnlinePayments");
  constructor(private readonly db: Db, private readonly billing: BillingService, private readonly audit: AuditService, private readonly messaging: MessagingService, private readonly settings: SettingsService) {}

  /**
   * Creates (or reuses) a payment link for what's still due on an invoice.
   * The amount always comes from the server's own balance, never from the browser.
   */
  async linkForInvoice(tx: Tx, userId: string, invoiceId: string) {
    const provider = paymentProvider();
    if (!provider) throw unprocessable("PAYMENTS_NOT_CONFIGURED", "Online payments aren't set up yet. Add the Razorpay keys (see the operations guide).");
    const inv = await tx.invoice.findUnique({ where: { id: invoiceId }, include: { member: true, allocations: true } });
    if (!inv) throw notFound("Invoice");
    if (!["ISSUED", "PARTIALLY_PAID"].includes(inv.status)) throw unprocessable("NOTHING_DUE", inv.status === "PAID" ? "This invoice is already paid" : "This invoice can't be paid");
    const due = inv.totalPaise - inv.allocations.reduce((s, a) => s + a.amountPaise, 0);
    if (due < 100) throw unprocessable("NOTHING_DUE", "Nothing left to pay on this invoice");

    const existing = await tx.gatewayOrder.findFirst({ where: { invoiceId, status: "CREATED", amountPaise: due, expiresAt: { gt: new Date(Date.now() + 3600_000) } }, orderBy: { createdAt: "desc" } });
    const brand = (await this.settings.business()).brandName;
    if (existing) return { orderId: existing.id, url: await this.urlFor(existing.providerOrderId, existing.id), amountPaise: due, expiresAt: existing.expiresAt, provider, invoiceNumber: inv.invoiceNumber, memberFirstName: inv.member.firstName, memberPhone: inv.member.phone, brand };

    const id = randomUUID();
    const expiresAt = new Date(Date.now() + LINK_DAYS * 86_400_000);
    let providerOrderId: string, url: string;
    if (provider === "razorpay") {
      const res = await fetch(`${config.razorpay.apiBase}/v1/payment_links`, {
        method: "POST",
        headers: { authorization: rzpAuth(), "content-type": "application/json" },
        body: JSON.stringify({
          amount: due, currency: "INR", accept_partial: false, reference_id: id.replace(/-/g, ""),
          description: `${brand}: invoice ${inv.invoiceNumber}`.slice(0, 2048),
          customer: { name: [inv.member.firstName, inv.member.lastName].filter(Boolean).join(" "), contact: inv.member.phone, ...(inv.member.email ? { email: inv.member.email } : {}) },
          notify: { sms: false, email: false }, reminder_enable: false,
          callback_url: `${config.publicAppUrl}/pay/${id}`, callback_method: "get",
          expire_by: Math.floor(expiresAt.getTime() / 1000),
          notes: { invoice_id: inv.id, invoice_number: inv.invoiceNumber ?? "" },
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const json: any = await res.json().catch(() => ({}));
      if (!res.ok || !json.id || !json.short_url) {
        this.log.error(`Razorpay link failed: ${res.status} ${JSON.stringify(json?.error ?? {})}`);
        throw new AppError(502, "GATEWAY_ERROR", "Razorpay didn't create the link. Try again in a minute.");
      }
      providerOrderId = json.id; url = json.short_url;
    } else {
      providerOrderId = `sim_${id.replace(/-/g, "")}`; url = `${config.publicAppUrl}/pay/${id}`;
    }
    await tx.gatewayOrder.create({ data: { id, provider: provider === "razorpay" ? "RAZORPAY" : "SIMULATOR", providerOrderId, invoiceId, amountPaise: due, expiresAt } });
    await this.audit.log(tx, { userId, branchId: inv.branchId, action: "payment_link.create", entityType: "Invoice", entityId: invoiceId, after: { amountPaise: due, provider } });
    return { orderId: id, url, amountPaise: due, expiresAt, provider, invoiceNumber: inv.invoiceNumber, memberFirstName: inv.member.firstName, memberPhone: inv.member.phone, brand };
  }

  private async urlFor(providerOrderId: string, orderId: string) {
    if (providerOrderId.startsWith("sim_")) return `${config.publicAppUrl}/pay/${orderId}`;
    const res = await fetch(`${config.razorpay.apiBase}/v1/payment_links/${providerOrderId}`, { headers: { authorization: rzpAuth() }, signal: AbortSignal.timeout(10_000) });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok || !json.short_url) throw new AppError(502, "GATEWAY_ERROR", "Couldn't fetch the payment link from Razorpay");
    return json.short_url as string;
  }

  /**
   * Records a payment the gateway has confirmed. Exactly-once: the gateway payment id is unique,
   * and the amount must match the order we created.
   */
  async markPaid(providerOrderId: string, gatewayPaymentId: string, amountPaise: number, currency: string) {
    return this.db.run({ userId: SYSTEM, branchIds: "*" }, async (tx) => {
      const order = await tx.gatewayOrder.findUnique({ where: { providerOrderId }, include: { invoice: { include: { member: true } } } });
      if (!order) return { ok: false, reason: "unknown_order" };
      if (await tx.payment.findUnique({ where: { gatewayPaymentId } })) return { ok: true, duplicate: true };
      if (currency !== "INR" || amountPaise !== order.amountPaise) {
        await this.audit.log(tx, { action: "payment.gateway.mismatch", entityType: "GatewayOrder", entityId: order.id, result: "FAILED", metadata: { expected: order.amountPaise, got: amountPaise, currency } });
        return { ok: false, reason: "amount_mismatch" };
      }
      const inv = order.invoice;
      const paid = (await tx.paymentAllocation.aggregate({ where: { invoiceId: inv.id }, _sum: { amountPaise: true } }))._sum.amountPaise ?? 0;
      const allocate = Math.max(0, Math.min(amountPaise, inv.totalPaise - paid));
      const [{ n }] = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('receipt_no_seq') AS n`;
      const branch = await tx.branch.findUniqueOrThrow({ where: { id: inv.branchId }, select: { code: true } });
      const payment = await tx.payment.create({
        data: {
          receiptNumber: `RC-${branch.code}-${String(n).padStart(6, "0")}`, branchId: inv.branchId, memberId: inv.memberId, method: "GATEWAY", status: "CONFIRMED",
          amountPaise, unallocatedPaise: amountPaise - allocate, gatewayOrderId: order.id, gatewayPaymentId, referenceNumber: gatewayPaymentId, receivedAt: new Date(),
        },
      });
      if (allocate > 0) {
        await tx.paymentAllocation.create({ data: { paymentId: payment.id, invoiceId: inv.id, amountPaise: allocate } });
        await this.billing.settleInvoice(tx, inv.id);
      }
      await tx.gatewayOrder.update({ where: { id: order.id }, data: { status: "PAID" } });
      await this.audit.log(tx, { branchId: inv.branchId, action: "payment.gateway", entityType: "Payment", entityId: payment.id, after: { amountPaise, gatewayPaymentId, invoice: inv.invoiceNumber } });
      await this.messaging.queue(tx, { key: "payment.receipt", memberId: inv.memberId, phone: inv.member.phone, dedupeKey: `rcpt:${payment.id}`, vars: this.messaging.receiptVars(inv.member.firstName, amountPaise, payment.receiptNumber) });
      return { ok: true, paymentId: payment.id };
    });
  }
}

@Controller()
export class OnlineController {
  private readonly log = new Logger("Webhook");
  constructor(private readonly db: Db, private readonly online: OnlinePayments, private readonly settings: SettingsService) {}

  @Get("payments/online/status")
  @Requires("payments.read", "payments.collect")
  status() {
    return { provider: paymentProvider() };
  }

  @Post("invoices/:id/payment-link")
  @HttpCode(200)
  @Requires("payments.collect")
  link(@CurrentScope() scope: S, @Param("id", ParseUUIDPipe) id: string) {
    return this.db.run(scope, async (tx) => {
      const inv = await tx.invoice.findFirst({ where: { id, ...branchWhere(scope.branchIds) }, select: { id: true } });
      if (!inv) throw notFound("Invoice");
      return this.online.linkForInvoice(tx, scope.userId, id);
    });
  }

  /** Razorpay webhook. Signature is checked on the raw body before anything is trusted. */
  @Public()
  @Post("webhooks/razorpay")
  @HttpCode(200)
  async razorpay(@Req() req: Request & { rawBody?: Buffer }, @Headers("x-razorpay-signature") sig?: string, @Headers("x-razorpay-event-id") eventId?: string) {
    const raw = req.rawBody;
    if (!config.razorpay.webhookSecret || !raw || !sig) throw new AppError(400, "BAD_WEBHOOK", "Invalid webhook");
    const expected = createHmac("sha256", config.razorpay.webhookSecret).update(raw).digest("hex");
    const a = Buffer.from(expected), b = Buffer.from(String(sig));
    const valid = a.length === b.length && timingSafeEqual(a, b);
    const body = JSON.parse(raw.toString("utf8"));
    const evId = eventId || `${body?.event}:${body?.payload?.payment?.entity?.id ?? body?.created_at}`;
    if (!valid) {
      this.log.warn(`Rejected webhook with bad signature (${evId})`);
      throw new AppError(400, "BAD_SIGNATURE", "Invalid signature");
    }
    const stored = await this.db.raw.webhookEvent.create({ data: { provider: "RAZORPAY", providerEventId: evId, eventType: String(body?.event ?? ""), signatureValid: true, payload: body } }).catch(() => null);
    if (!stored) return { ok: true, duplicate: true };
    let result: unknown = { ignored: true };
    try {
      if (body.event === "payment_link.paid") {
        const link = body.payload?.payment_link?.entity;
        const pay = body.payload?.payment?.entity;
        result = await this.online.markPaid(link.id, pay.id, Number(pay.amount), pay.currency);
      }
      await this.db.raw.webhookEvent.update({ where: { id: stored.id }, data: { processedAt: new Date(), attempts: 1 } });
    } catch (e) {
      await this.db.raw.webhookEvent.update({ where: { id: stored.id }, data: { attempts: 1, processingError: String((e as Error).message).slice(0, 500) } });
      throw e; // 500 → Razorpay retries
    }
    return { ok: true, result };
  }

  // ---------------- Demo payment page (PAYMENTS_SIMULATOR=1 only) ----------------
  @Public()
  @Get("public/pay/:orderId")
  async payInfo(@Param("orderId", ParseUUIDPipe) orderId: string) {
    const o = await this.db.run({ userId: SYSTEM, branchIds: "*" }, (tx) => tx.gatewayOrder.findUnique({ where: { id: orderId }, include: { invoice: { include: { member: { select: { firstName: true } }, items: { select: { description: true } } } } } }));
    if (!o) throw notFound("Payment");
    return {
      brandName: (await this.settings.business()).brandName, amountPaise: o.amountPaise, status: o.status, expiresAt: o.expiresAt, simulator: o.provider === "SIMULATOR",
      invoiceNumber: o.invoice.invoiceNumber, firstName: o.invoice.member.firstName, items: o.invoice.items.map((i) => i.description),
    };
  }

  @Public()
  @Post("public/pay/:orderId/simulate")
  @HttpCode(200)
  async simulate(@Param("orderId", ParseUUIDPipe) orderId: string) {
    if (!config.paymentsSimulator) throw notFound();
    const o = await this.db.raw.gatewayOrder.findUnique({ where: { id: orderId } });
    if (!o || o.provider !== "SIMULATOR") throw notFound("Payment");
    if (o.expiresAt < new Date()) throw unprocessable("EXPIRED", "This payment link has expired");
    return this.online.markPaid(o.providerOrderId, `sim_pay_${randomUUID().slice(0, 12)}`, o.amountPaise, "INR");
  }
}
