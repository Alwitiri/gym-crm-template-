import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { AuditService } from "../core/audit.service";
import { CurrentScope, Requires } from "../core/auth";
import { branchWhere, Db, Scope } from "../core/db.service";
import { notFound, unprocessable } from "../core/errors";
import type { Permission } from "../core/permissions";
import { Zod } from "../core/validation";
import { MessagingService } from "./messaging.service";

type S = Scope & { permission: Permission };
const LABEL: Record<string, string> = {
  welcome: "Welcome", "expiry.before": "Expiring soon", "expiry.today": "Expires today", "expiry.after": "Lapsed member", "dues.reminder": "Payment due",
  "pt.tomorrow": "PT tomorrow", "payment.receipt": "Payment receipt", birthday: "Birthday",
};

@Controller()
export class MessagesController {
  constructor(private readonly db: Db, private readonly audit: AuditService, private readonly messaging: MessagingService) {}

  @Get("notifications")
  @Requires("notifications.read")
  async list(@CurrentScope() scope: S, @Query("status") status = "QUEUED", @Query("page") page = "1") {
    const p = Math.max(1, Number(page) || 1);
    const st = ["QUEUED", "SENT", "FAILED", "SKIPPED_NO_CONSENT"].includes(status) ? status : "QUEUED";
    const where = { status: st as any, member: { deletedAt: null, ...branchWhere(scope.branchIds, "homeBranchId") } };
    const [total, rows, counts] = await this.db.run(scope, (tx) => Promise.all([
      tx.notificationLog.count({ where }),
      tx.notificationLog.findMany({
        where, orderBy: st === "QUEUED" ? { scheduledFor: "asc" } : { createdAt: "desc" }, skip: (p - 1) * 50, take: 50,
        include: { template: { select: { key: true } }, member: { select: { id: true, firstName: true, lastName: true, memberCode: true } } },
      }),
      tx.notificationLog.groupBy({ by: ["status"], where: { member: where.member }, _count: { _all: true } }),
    ]));
    return {
      mode: this.messaging.mode, page: p, pageSize: 50, total,
      counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
      data: rows.map((r) => {
        const text = ((r.payload ?? {}) as { text?: string }).text ?? "";
        return {
          id: r.id, kind: r.template?.key ?? null, kindLabel: LABEL[r.template?.key ?? ""] ?? "Message", status: r.status, text, destination: r.destination,
          memberId: r.member?.id ?? null, memberName: r.member ? [r.member.firstName, r.member.lastName].filter(Boolean).join(" ") : null, memberCode: r.member?.memberCode,
          whatsappUrl: `https://wa.me/${r.destination.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`,
          scheduledFor: r.scheduledFor, sentAt: r.sentAt, errorMessage: r.errorMessage,
        };
      }),
    };
  }

  @Post("notifications/:id/sent")
  @HttpCode(200)
  @Requires("notifications.send")
  async markSent(@CurrentScope() scope: S, @Param("id", ParseUUIDPipe) id: string) {
    const r = await this.db.run(scope, (tx) => tx.notificationLog.findFirst({ where: { id, member: branchWhere(scope.branchIds, "homeBranchId") } }));
    if (!r) throw notFound("Message");
    if (r.status !== "QUEUED") throw unprocessable("NOT_QUEUED", "This message isn't waiting to be sent");
    return this.db.raw.notificationLog.update({ where: { id }, data: { status: "SENT", sentAt: new Date(), errorMessage: "Sent by staff from WhatsApp" } });
  }

  @Post("notifications/:id/skip")
  @HttpCode(200)
  @Requires("notifications.send")
  async skip(@CurrentScope() scope: S, @Param("id", ParseUUIDPipe) id: string) {
    const r = await this.db.run(scope, (tx) => tx.notificationLog.findFirst({ where: { id, member: branchWhere(scope.branchIds, "homeBranchId") } }));
    if (!r) throw notFound("Message");
    if (r.status !== "QUEUED") throw unprocessable("NOT_QUEUED", "This message isn't waiting to be sent");
    return this.db.raw.notificationLog.update({ where: { id }, data: { status: "FAILED", errorMessage: "Skipped by staff" } });
  }

  /** Generate today's reminders now (they also run on their own every hour after the configured time). */
  @Post("notifications/run")
  @HttpCode(200)
  @Requires("notifications.manage")
  async run(@CurrentScope() scope: S) {
    const queued = await this.messaging.generate();
    const sent = await this.messaging.dispatch();
    await this.audit.log(this.db.raw, { userId: scope.userId, action: "notifications.run", metadata: { queued, ...sent } });
    return { queued, ...sent, mode: this.messaging.mode };
  }

  @Get("notification-templates")
  @Requires("notifications.read")
  async templates() {
    const rows = await this.db.raw.notificationTemplate.findMany({ orderBy: { key: "asc" } });
    return rows.map((t) => ({ ...t, label: LABEL[t.key] ?? t.key, variables: [...t.body.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]) }));
  }

  @Patch("notification-templates/:id")
  @Requires("notifications.manage")
  async updateTemplate(@CurrentScope() scope: S, @Param("id", ParseUUIDPipe) id: string, @Body(new Zod(z.object({ body: z.string().trim().min(5).max(1000).optional(), enabled: z.boolean().optional(), providerTemplateName: z.string().trim().regex(/^[a-z0-9_]{1,512}$/).optional() }))) b: { body?: string; enabled?: boolean; providerTemplateName?: string }) {
    const before = await this.db.raw.notificationTemplate.findUnique({ where: { id } });
    if (!before) throw notFound("Template");
    if (b.body) {
      const allowed = new Set([...before.body.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).concat("gym"));
      const unknown = [...b.body.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).filter((v) => !allowed.has(v));
      if (unknown.length) throw unprocessable("UNKNOWN_VARIABLE", `This message can't use {{${unknown[0]}}}. Available: ${[...allowed].map((v) => `{{${v}}}`).join(", ")}`);
    }
    const t = await this.db.raw.notificationTemplate.update({ where: { id }, data: b });
    await this.audit.log(this.db.raw, { userId: scope.userId, action: "notification_template.update", entityType: "NotificationTemplate", entityId: id, before, after: t });
    return t;
  }
}
