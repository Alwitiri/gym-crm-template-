import { Body, Controller, ForbiddenException, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, Res } from "@nestjs/common";
import { createHmac, randomInt } from "node:crypto";
import type { Response } from "express";
import { z } from "zod";
import { AuditService } from "../core/audit.service";
import { AuthContext, AuthedRequest, CurrentAuth, csrfFor, newToken, Public, SESSION_COOKIE, sha256 } from "../core/auth";
import { config } from "../core/config";
import { diffDays, istDate, ymd } from "../core/dates";
import { Db, Tx } from "../core/db.service";
import { AppError, notFound, unprocessable } from "../core/errors";
import { SettingsService } from "../core/settings.service";
import { normalisePhone, Zod } from "../core/validation";
import { BillingService } from "./billing.service";
import { MessagingService } from "./messaging.service";
import { OnlinePayments, paymentProvider } from "./online.controller";

const SYSTEM = "00000000-0000-0000-0000-000000000000";
const OTP_TTL_MIN = 5;
const OTP_MAX_ATTEMPTS = 5;
const phoneSchema = z.string().trim().min(10).max(16).transform(normalisePhone).refine((p) => /^\+\d{10,15}$/.test(p), "Enter a valid mobile number");

const hits = new Map<string, number[]>();
function limit(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => t > now - windowMs);
  if (arr.length >= max) throw new AppError(429, "RATE_LIMITED", "Too many tries. Please wait a few minutes.");
  arr.push(now);
  hits.set(key, arr);
}
const otpHash = (challengeId: string, code: string) => createHmac("sha256", config.sessionSecret).update(`${challengeId}:${code}`).digest("hex");

/** Member app: OTP login and the member's own data. Every /me query is pinned to the logged-in member's id. */
@Controller()
export class PortalController {
  constructor(
    private readonly db: Db, private readonly audit: AuditService, private readonly billing: BillingService,
    private readonly online: OnlinePayments, private readonly messaging: MessagingService, private readonly settings: SettingsService,
  ) {}

  // ---------------------------------------------------------------- OTP login
  @Public()
  @Post("member-auth/otp")
  @HttpCode(200)
  async requestOtp(@Body(new Zod(z.object({ phone: phoneSchema }))) b: { phone: string }, @Req() req: AuthedRequest) {
    limit("otp-ip:" + req.ip, 10, 15 * 60_000);
    limit("otp-ph:" + b.phone, 3, 15 * 60_000);
    const member = await this.findMember(b.phone);
    const generic = { sent: true, message: "If this number belongs to a member, a 6-digit code is on its way on WhatsApp." };
    if (!member) {
      await this.audit.log(this.db.raw, { action: "member.otp.request", result: "FAILED", metadata: { reason: "unknown_phone" } });
      return generic;
    }
    if (this.messaging.mode !== "whatsapp_cloud" && !config.otpDevEcho) {
      throw new AppError(503, "OTP_UNAVAILABLE", "Member login isn't switched on yet. Please ask at the front desk.");
    }
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const ch = await this.db.raw.otpChallenge.create({ data: { phone: b.phone, purpose: "LOGIN", codeHash: "pending", expiresAt: new Date(Date.now() + OTP_TTL_MIN * 60_000), userId: member.userId } });
    await this.db.raw.otpChallenge.update({ where: { id: ch.id }, data: { codeHash: otpHash(ch.id, code) } });
    if (this.messaging.mode === "whatsapp_cloud") {
      const ok = await this.messaging.sendNow(b.phone, "login_otp", [code]).catch(() => false);
      if (!ok && !config.otpDevEcho) throw new AppError(502, "OTP_SEND_FAILED", "Couldn't send the code. Try again in a minute.");
    }
    return config.otpDevEcho ? { ...generic, devCode: code } : generic;
  }

  @Public()
  @Post("member-auth/verify")
  @HttpCode(200)
  async verifyOtp(@Body(new Zod(z.object({ phone: phoneSchema, code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code") }))) b: { phone: string; code: string }, @Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    limit("otpv-ip:" + req.ip, 20, 15 * 60_000);
    const ch = await this.db.raw.otpChallenge.findFirst({ where: { phone: b.phone, purpose: "LOGIN", consumedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } });
    const wrong = new AppError(401, "INVALID_CODE", "That code is wrong or has expired. Request a new one.");
    if (!ch || ch.attempts >= OTP_MAX_ATTEMPTS) throw wrong;
    if (otpHash(ch.id, b.code) !== ch.codeHash) {
      await this.db.raw.otpChallenge.update({ where: { id: ch.id }, data: { attempts: { increment: 1 } } });
      throw wrong;
    }
    await this.db.raw.otpChallenge.update({ where: { id: ch.id }, data: { consumedAt: new Date() } });
    const member = await this.findMember(b.phone);
    if (!member) throw wrong;

    // Link (or create) the login account for this member.
    let userId = member.userId;
    if (!userId) {
      const existing = await this.db.raw.user.findUnique({ where: { phone: b.phone } });
      const user = existing ?? (await this.db.raw.user.create({ data: { phone: b.phone, displayName: [member.firstName, member.lastName].filter(Boolean).join(" ") } }));
      userId = user.id;
      await this.db.run({ userId: SYSTEM, branchIds: "*" }, (tx) => tx.member.update({ where: { id: member.id }, data: { userId } }));
    }
    const user = await this.db.raw.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.status !== "ACTIVE" || user.deletedAt) throw wrong;

    const token = newToken();
    const csrf = csrfFor(token);
    const expiresAt = new Date(Date.now() + 30 * 86_400_000);
    const s = await this.db.raw.session.create({
      data: {
        userId, tokenHash: sha256(token), csrfSecretHash: sha256(csrf), expiresAt, deviceLabel: "Member app",
        ipAddress: req.ip && /^[0-9a-f:.]+$/i.test(req.ip) ? req.ip.replace(/^::ffff:/, "") : null, userAgent: String(req.headers["user-agent"] ?? "").slice(0, 300),
      },
    });
    await this.db.raw.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
    await this.audit.log(this.db.raw, { userId, action: "member.login", entityType: "Session", entityId: s.id });
    res.cookie(SESSION_COOKIE, token, { httpOnly: true, secure: config.isProd, sameSite: "lax", path: "/", expires: expiresAt });
    return { status: "AUTHENTICATED", csrfToken: csrf };
  }

  private findMember(phone: string) {
    return this.db.run({ userId: SYSTEM, branchIds: "*" }, (tx) =>
      tx.member.findFirst({ where: { phone, deletedAt: null }, orderBy: [{ userId: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }] }),
    );
  }

  // ---------------------------------------------------------------- member's own data
  private me<T>(auth: AuthContext, fn: (tx: Tx, memberId: string) => Promise<T>) {
    if (!auth.memberId) throw new ForbiddenException("This page is for members");
    return this.db.run({ userId: auth.userId, branchIds: "*" }, (tx) => fn(tx, auth.memberId!));
  }

  @Get("me/home")
  home(@CurrentAuth() auth: AuthContext) {
    return this.me(auth, async (tx, memberId) => {
      const today = istDate();
      const m = await tx.member.findUniqueOrThrow({ where: { id: memberId }, include: { homeBranch: { select: { name: true, phone: true, addressLine1: true, city: true } } } });
      const subs = await tx.subscription.findMany({ where: { memberId, status: { in: ["ACTIVE", "FROZEN", "SCHEDULED", "EXPIRED"] } }, orderBy: { endDate: "desc" }, take: 3, include: { plan: { select: { name: true } } } });
      const current = subs.find((s) => ["ACTIVE", "FROZEN"].includes(s.status)) ?? subs.find((s) => s.status === "SCHEDULED") ?? subs[0] ?? null;
      const upcoming = subs.find((s) => s.status === "SCHEDULED" && s.id !== current?.id) ?? null;
      const invoices = await tx.invoice.findMany({ where: { memberId, status: { in: ["ISSUED", "PARTIALLY_PAID"] } }, include: { allocations: true, items: { select: { description: true } } }, orderBy: { issueDate: "asc" } });
      const dues = invoices.map((i) => ({ id: i.id, invoiceNumber: i.invoiceNumber, description: i.items[0]?.description ?? "Invoice", totalPaise: i.totalPaise, duePaise: i.totalPaise - i.allocations.reduce((s, a) => s + a.amountPaise, 0) })).filter((d) => d.duePaise > 0);
      const visits = await tx.attendance.findMany({ where: { memberId, result: "ALLOWED" as any }, orderBy: { checkInAt: "desc" }, take: 60, select: { checkInAt: true, checkOutAt: true, branch: { select: { name: true } } } });
      const monthStart = today.slice(0, 8) + "01";
      const pt = await tx.memberPtPackage.findMany({ where: { memberId, status: "ACTIVE" }, include: { ptPackage: { select: { name: true } }, trainer: { include: { user: { select: { displayName: true } } } } } });
      const sessions = await tx.ptSession.findMany({ where: { memberId, status: "SCHEDULED", scheduledStart: { gte: new Date() } }, orderBy: { scheduledStart: "asc" }, take: 5, include: { trainer: { include: { user: { select: { displayName: true } } } } } });
      const workout = await tx.workoutPlan.findFirst({ where: { memberId, isActive: true }, orderBy: { createdAt: "desc" }, select: { id: true, name: true } });
      const diet = await tx.dietPlan.findFirst({ where: { memberId, isActive: true }, orderBy: { createdAt: "desc" }, select: { id: true, name: true } });
      return {
        member: { firstName: m.firstName, lastName: m.lastName, memberCode: m.memberCode, phone: m.phone, status: m.status, qrToken: m.qrToken, branch: m.homeBranch },
        membership: current && {
          planName: current.plan.name, status: current.status, startDate: ymd(current.startDate), endDate: ymd(current.endDate),
          daysLeft: current.status === "EXPIRED" ? 0 : Math.max(0, diffDays(today, ymd(current.endDate)) + 1),
          totalDays: diffDays(ymd(current.startDate), ymd(current.endDate)) + 1,
        },
        upcoming: upcoming && { planName: upcoming.plan.name, startDate: ymd(upcoming.startDate), endDate: ymd(upcoming.endDate) },
        dues, onlinePayments: !!paymentProvider(),
        visits: { thisMonth: visits.filter((v) => istDate(v.checkInAt) >= monthStart).length, recent: visits.slice(0, 10).map((v) => ({ at: v.checkInAt, out: v.checkOutAt, branch: v.branch.name })) },
        pt: pt.map((p) => ({ name: p.ptPackage.name, trainer: p.trainer.user.displayName, left: p.sessionsTotal - p.sessionsUsed, total: p.sessionsTotal, validUntil: ymd(p.validUntil) })),
        sessions: sessions.map((s) => ({ at: s.scheduledStart, end: s.scheduledEnd, trainer: s.trainer.user.displayName })),
        workout, diet,
      };
    });
  }

  @Get("me/plans")
  plans(@CurrentAuth() auth: AuthContext) {
    return this.me(auth, async (tx, memberId) => {
      const m = await tx.member.findUniqueOrThrow({ where: { id: memberId }, select: { homeBranchId: true } });
      const plans = await tx.membershipPlan.findMany({
        where: { status: "ACTIVE", OR: [{ allBranchAccess: true }, { branches: { some: { branchId: m.homeBranchId } } }] },
        orderBy: { durationDays: "asc" }, select: { id: true, name: true, durationDays: true, pricePaise: true, taxRateBp: true, description: true, facilities: true },
      });
      return plans;
    });
  }

  /** Member picks a plan → invoice for the renewal → payment link. Membership starts the day after the current one ends. */
  @Post("me/renew")
  @HttpCode(200)
  renew(@CurrentAuth() auth: AuthContext, @Body(new Zod(z.object({ planId: z.string().uuid() }))) b: { planId: string }) {
    if (!paymentProvider()) throw unprocessable("PAYMENTS_NOT_CONFIGURED", "Online payment isn't available. Please renew at the front desk.");
    return this.me(auth, async (tx, memberId) => {
      // Don't pile up unpaid renewals: reuse a pending one for the same plan, cancel others.
      const pending = await tx.subscription.findMany({ where: { memberId, status: "PENDING_PAYMENT" }, include: { invoice: { include: { allocations: true } } } });
      const same = pending.find((p) => p.planId === b.planId && p.invoice && p.invoice.allocations.length === 0 && p.invoice.status === "ISSUED");
      let invoiceId = same?.invoiceId ?? null;
      if (!invoiceId) {
        const quote = await this.billing.quoteMembership(tx, { memberId, planId: b.planId }, { unlimitedDiscount: false, canBackdate: false });
        const sale = await this.billing.sellMembership(tx, auth.userId, memberId, quote, undefined);
        invoiceId = sale.invoice.id;
      }
      return this.online.linkForInvoice(tx, auth.userId, invoiceId!);
    });
  }

  @Post("me/invoices/:id/pay")
  @HttpCode(200)
  pay(@CurrentAuth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.me(auth, async (tx, memberId) => {
      const inv = await tx.invoice.findFirst({ where: { id, memberId }, select: { id: true } });
      if (!inv) throw notFound("Invoice");
      return this.online.linkForInvoice(tx, auth.userId, id);
    });
  }

  // ---------------------------------------------------------------- public join form → lead
  @Public()
  @Get("public/join")
  async joinInfo() {
    const brand = await this.settings.business();
    const [branches, plans] = await this.db.run({ userId: SYSTEM, branchIds: "*" }, (tx) => Promise.all([
      tx.branch.findMany({ where: { status: "ACTIVE" }, orderBy: { code: "asc" }, select: { id: true, name: true, city: true, addressLine1: true } }),
      tx.membershipPlan.findMany({ where: { status: "ACTIVE" }, orderBy: { durationDays: "asc" }, select: { id: true, name: true, durationDays: true, pricePaise: true } }),
    ]));
    return { brandName: brand.brandName, branches, plans };
  }

  @Public()
  @Post("public/enquiries")
  @HttpCode(200)
  async enquiry(@Req() req: AuthedRequest, @Body(new Zod(z.object({
    name: z.string().trim().min(2).max(80), phone: phoneSchema, email: z.string().trim().email().max(120).optional().or(z.literal("")),
    branchId: z.string().uuid(), planId: z.string().uuid().optional().or(z.literal("")), goal: z.string().trim().max(300).optional(),
    source: z.enum(["WEBSITE", "INSTAGRAM", "FACEBOOK", "GOOGLE_ADS", "WHATSAPP", "OTHER"]).default("WEBSITE"), campaign: z.string().trim().max(80).optional(),
    company: z.string().max(200).optional(), // honeypot: hidden field real people never fill
  }))) b: { name: string; phone: string; email?: string; branchId: string; planId?: string; goal?: string; source: any; campaign?: string; company?: string }) {
    if (b.company) return { ok: true }; // bot
    limit("enq-ip:" + req.ip, 5, 60 * 60_000);
    return this.db.run({ userId: SYSTEM, branchIds: "*" }, async (tx) => {
      const branch = await tx.branch.findFirst({ where: { id: b.branchId, status: "ACTIVE" } });
      if (!branch) throw notFound("Branch");
      const open = await tx.lead.findFirst({ where: { phone: b.phone, branchId: b.branchId, deletedAt: null, stage: { notIn: ["CONVERTED", "LOST"] } } });
      if (open) {
        await tx.lead.update({ where: { id: open.id }, data: { nextFollowUpAt: new Date(), priority: "HIGH" } });
        return { ok: true };
      }
      const lead = await tx.lead.create({
        data: {
          branchId: b.branchId, name: b.name, phone: b.phone, email: b.email || null, source: b.source, sourceDetail: [b.campaign, b.goal].filter(Boolean).join(" · ").slice(0, 300) || null,
          interestedPlanId: b.planId || null, nextFollowUpAt: new Date(), priority: "HIGH",
        },
      });
      await this.audit.log(tx, { branchId: b.branchId, action: "lead.web_enquiry", entityType: "Lead", entityId: lead.id });
      return { ok: true };
    });
  }
}


