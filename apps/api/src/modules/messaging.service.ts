import { Injectable, Logger } from "@nestjs/common";
import { config } from "../core/config";
import { addDays, dbDate, diffDays, istDate, istDayStart, ymd } from "../core/dates";
import { Db, Tx } from "../core/db.service";
import { SettingsService } from "../core/settings.service";

/** Default message templates. Staff can edit them; for WhatsApp Cloud API each needs an approved template with the same variables in the same order. */
export const DEFAULT_TEMPLATES: { key: string; body: string; isMarketing?: boolean }[] = [
  { key: "welcome", body: "Welcome to {{gym}}, {{firstName}}! Your member code is {{memberCode}}. Show your membership card at the front desk to check in." },
  { key: "expiry.before", body: "Hi {{firstName}}, your {{planName}} membership at {{gym}} ends on {{endDate}} ({{days}} days left). Renew at the front desk to keep training without a break." },
  { key: "expiry.today", body: "Hi {{firstName}}, your {{planName}} membership at {{gym}} ends today. Renew today so your card keeps working tomorrow." },
  { key: "expiry.after", body: "Hi {{firstName}}, we miss you at {{gym}}! Your membership ended on {{endDate}}. Renew this week and pick up where you left off." },
  { key: "dues.reminder", body: "Hi {{firstName}}, a balance of {{amount}} is due at {{gym}} for invoice {{invoiceNumber}}. {{payLine}}" },
  { key: "pt.tomorrow", body: "Hi {{firstName}}, reminder: personal training with {{trainer}} tomorrow at {{time}} at {{gym}}." },
  { key: "payment.receipt", body: "Hi {{firstName}}, we received {{amount}} at {{gym}}. Receipt {{receiptNumber}}. Thank you!" },
  { key: "birthday", body: "Happy birthday, {{firstName}}! Everyone at {{gym}} wishes you a great year ahead.", isMarketing: true },
];

const inr = (paise: number) => "₹" + new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(paise / 100);
const fmtDate = (ymdStr: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(ymdStr + "T00:00:00Z"));

export function render(body: string, vars: Record<string, string>) {
  const params: string[] = [];
  const text = body.replace(/\{\{(\w+)\}\}/g, (_, k) => { const v = vars[k] ?? ""; params.push(v); return v; }).replace(/\s+$/, "");
  return { text, params };
}

interface QueueInput { key: string; memberId: string; phone: string; vars: Record<string, string>; dedupeKey: string; scheduledFor?: Date }

@Injectable()
export class MessagingService {
  private readonly log = new Logger("Messaging");
  constructor(private readonly db: Db, private readonly settings: SettingsService) {}

  get mode(): "whatsapp_cloud" | "manual" {
    return config.whatsapp.phoneNumberId && config.whatsapp.token ? "whatsapp_cloud" : "manual";
  }

  async ensureTemplates() {
    for (const t of DEFAULT_TEMPLATES) {
      await this.db.raw.notificationTemplate.upsert({
        where: { key_channel_language: { key: t.key, channel: "WHATSAPP", language: "en" } },
        create: { key: t.key, channel: "WHATSAPP", language: "en", body: t.body, isMarketing: !!t.isMarketing, providerTemplateName: t.key.replace(/\./g, "_") },
        update: {},
      });
    }
  }

  /** Adds one message to the queue. The dedupe key makes repeats harmless (same reminder is never queued twice). */
  async queue(tx: Pick<Tx, "notificationTemplate" | "notificationLog">, q: QueueInput) {
    const t = await tx.notificationTemplate.findUnique({ where: { key_channel_language: { key: q.key, channel: "WHATSAPP", language: "en" } } });
    if (!t || !t.enabled) return null;
    const { text, params } = render(t.body, { gym: (await this.settings.business()).brandName, ...q.vars });
    // ON CONFLICT DO NOTHING — a failed insert would abort the surrounding transaction.
    const r = await tx.notificationLog.createMany({
      data: [{ templateId: t.id, memberId: q.memberId, channel: "WHATSAPP", destination: q.phone, status: "QUEUED", dedupeKey: q.dedupeKey, payload: { text, params }, scheduledFor: q.scheduledFor ?? new Date() }],
      skipDuplicates: true,
    });
    return r.count > 0 ? { text } : null;
  }

  /** Daily reminder generation. Safe to run as often as you like. */
  async generate(): Promise<number> {
    const s = await this.settings.get();
    if (!s["reminders.enabled"]) return 0;
    const today = istDate();
    let n = 0;
    await this.db.run({ userId: "00000000-0000-0000-0000-000000000000", branchIds: "*" }, async (tx) => {
      const q = async (input: QueueInput) => { if (await this.queue(tx, input)) n++; };
      const live = { deletedAt: null };

      // Expiring soon / today (only if not already renewed).
      for (const d of s["reminders.expiryDaysBefore"]) {
        const subs = await tx.subscription.findMany({
          where: { status: { in: ["ACTIVE", "FROZEN"] }, endDate: dbDate(addDays(today, d)), next: null, member: live },
          include: { member: true, plan: { select: { name: true } } },
        });
        for (const sub of subs) {
          await q({ key: d === 0 ? "expiry.today" : "expiry.before", memberId: sub.memberId, phone: sub.member.phone, dedupeKey: `exp:${sub.id}:${d}`,
            vars: { firstName: sub.member.firstName, planName: sub.plan.name, endDate: fmtDate(ymd(sub.endDate)), days: String(d) } });
        }
      }
      // Lapsed: ended N days ago and nothing newer.
      for (const d of s["reminders.expiryDaysAfter"]) {
        const subs = await tx.subscription.findMany({
          where: { status: { in: ["EXPIRED", "ACTIVE"] }, endDate: dbDate(addDays(today, -d)), next: null, member: { ...live, subscriptions: { none: { status: { in: ["ACTIVE", "SCHEDULED", "FROZEN"] }, endDate: { gte: dbDate(today) } } } } },
          include: { member: true, plan: { select: { name: true } } },
        });
        for (const sub of subs) {
          await q({ key: "expiry.after", memberId: sub.memberId, phone: sub.member.phone, dedupeKey: `expa:${sub.id}:${d}`,
            vars: { firstName: sub.member.firstName, planName: sub.plan.name, endDate: fmtDate(ymd(sub.endDate)), days: String(d) } });
        }
      }
      // Dues: every N days after the invoice date.
      const every = s["reminders.duesEveryDays"];
      const online = !!(config.razorpay.keyId && config.razorpay.keySecret) || config.paymentsSimulator;
      const payLine = online ? `Pay online in the member app: ${config.publicAppUrl}/m` : "Please pay at the front desk.";
      if (every > 0) {
        const dues = await tx.$queryRaw<{ invoiceId: string; memberId: string; duePaise: number }[]>`
          SELECT b."invoiceId", b."memberId", b."duePaise" FROM invoice_balance b WHERE b."duePaise" > 0`;
        for (const d of dues) {
          const inv = await tx.invoice.findUnique({ where: { id: d.invoiceId }, include: { member: true } });
          if (!inv || !inv.issueDate || inv.member.deletedAt) continue;
          const age = diffDays(ymd(inv.issueDate), today);
          if (age < 1 || age % every !== 0) continue;
          await q({ key: "dues.reminder", memberId: inv.memberId, phone: inv.member.phone, dedupeKey: `dues:${inv.id}:${age}`,
            vars: { firstName: inv.member.firstName, amount: inr(Number(d.duePaise)), invoiceNumber: inv.invoiceNumber ?? "", payLine } });
        }
      }
      // PT tomorrow.
      if (s["reminders.ptDayBefore"]) {
        const tomorrow = addDays(today, 1);
        const sessions = await tx.ptSession.findMany({
          where: { status: "SCHEDULED", scheduledStart: { gte: istDayStart(tomorrow), lt: istDayStart(addDays(tomorrow, 1)) } },
          include: { member: true, trainer: { include: { user: { select: { displayName: true } } } } },
        });
        for (const ps of sessions) {
          const time = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(ps.scheduledStart);
          await q({ key: "pt.tomorrow", memberId: ps.memberId, phone: ps.member.phone, dedupeKey: `pt:${ps.id}`, vars: { firstName: ps.member.firstName, trainer: ps.trainer.user.displayName, time } });
        }
      }
      // Birthdays: marketing, so only with WhatsApp consent.
      if (s["reminders.birthday"]) {
        const md = today.slice(5);
        const bday = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Member" WHERE "deletedAt" IS NULL AND status = 'ACTIVE' AND to_char("dateOfBirth", 'MM-DD') = ${md}`;
        for (const { id } of bday) {
          const latest = await tx.consentRecord.findFirst({ where: { memberId: id, purpose: "MARKETING_WHATSAPP" }, orderBy: { recordedAt: "desc" } });
          const m = await tx.member.findUniqueOrThrow({ where: { id } });
          if (!latest?.granted) {
            await tx.notificationLog.createMany({ data: [{ memberId: id, channel: "WHATSAPP", destination: m.phone, status: "SKIPPED_NO_CONSENT", dedupeKey: `bday:${id}:${today.slice(0, 4)}`, payload: { text: "(birthday wish not sent: no marketing consent)" } }], skipDuplicates: true });
            continue;
          }
          await q({ key: "birthday", memberId: id, phone: m.phone, dedupeKey: `bday:${id}:${today.slice(0, 4)}`, vars: { firstName: m.firstName } });
        }
      }
    }, 120_000);
    return n;
  }

  /** Sends queued messages through WhatsApp Cloud API. In manual mode nothing is sent; staff send from the Messages page. */
  async dispatch(limit = 50): Promise<{ sent: number; failed: number }> {
    if (this.mode !== "whatsapp_cloud") return { sent: 0, failed: 0 };
    const rows = await this.db.raw.notificationLog.findMany({
      where: { status: "QUEUED", channel: "WHATSAPP", scheduledFor: { lte: new Date() } },
      include: { template: true }, take: limit, orderBy: { scheduledFor: "asc" },
    });
    let sent = 0, failed = 0;
    for (const r of rows) {
      const payload = (r.payload ?? {}) as { params?: string[] };
      try {
        const res = await fetch(`${config.whatsapp.apiBase}/${config.whatsapp.phoneNumberId}/messages`, {
          method: "POST",
          headers: { authorization: `Bearer ${config.whatsapp.token}`, "content-type": "application/json" },
          body: JSON.stringify({
            messaging_product: "whatsapp", to: r.destination.replace(/^\+/, ""), type: "template",
            template: {
              name: r.template?.providerTemplateName, language: { code: config.whatsapp.language },
              components: payload.params?.length ? [{ type: "body", parameters: payload.params.map((text) => ({ type: "text", text })) }] : [],
            },
          }),
          signal: AbortSignal.timeout(10_000),
        });
        const json: any = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
        await this.db.raw.notificationLog.update({ where: { id: r.id }, data: { status: "SENT", sentAt: new Date(), providerMessageId: json?.messages?.[0]?.id ?? null } });
        sent++;
      } catch (e) {
        await this.db.raw.notificationLog.update({ where: { id: r.id }, data: { status: "FAILED", errorMessage: String((e as Error).message).slice(0, 300) } });
        failed++;
      }
    }
    if (sent || failed) this.log.log(`WhatsApp: ${sent} sent, ${failed} failed`);
    return { sent, failed };
  }

  /** Sends a one-off template message right away (used for login OTPs). Returns false if no sender is set up. */
  async sendNow(to: string, templateName: string, params: string[]): Promise<boolean> {
    if (this.mode !== "whatsapp_cloud") return false;
    const res = await fetch(`${config.whatsapp.apiBase}/${config.whatsapp.phoneNumberId}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${config.whatsapp.token}`, "content-type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp", to: to.replace(/^\+/, ""), type: "template",
        template: { name: templateName, language: { code: config.whatsapp.language }, components: [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }, { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: params[0] }] }] },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  }

  receiptVars(firstName: string, amountPaise: number, receiptNumber: string) {
    return { firstName, amount: inr(amountPaise), receiptNumber };
  }
}
