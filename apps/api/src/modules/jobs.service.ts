import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from "@nestjs/common";
import { dbDate, istDate } from "../core/dates";
import { Db } from "../core/db.service";
import { BillingService } from "./billing.service";
import { MessagingService } from "./messaging.service";
import { SettingsService } from "../core/settings.service";

/**
 * Phase 1: in-process scheduler for the daily subscription status sweep.
 * Moves SCHEDULED→ACTIVE on the start date and ACTIVE→EXPIRED after the end date, then
 * refreshes each affected member's status. Idempotent, so running it often is harmless.
 * Phase 4 moves this (and reminders) to BullMQ with a single worker.
 */
@Injectable()
export class JobsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger("Jobs");
  private timer?: NodeJS.Timeout;

  constructor(private readonly db: Db, private readonly billing: BillingService, private readonly messaging: MessagingService, private readonly settings: SettingsService) {}

  onApplicationBootstrap() {
    if (process.env.DISABLE_JOBS === "1") return;
    const tick = async () => { await this.sweep(); await this.reminders(); };
    void tick();
    this.timer = setInterval(() => void tick(), 15 * 60_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async sweep() {
    try {
      const today = dbDate(istDate());
      const changed = await this.db.run({ userId: "00000000-0000-0000-0000-000000000000", branchIds: "*" }, async (tx) => {
        // Freezes booked for a future date switch on and off by themselves.
        const freezingToday = await tx.subscription.findMany({
          where: { status: "ACTIVE", freezes: { some: { endedEarlyOn: null, startDate: { lte: today }, endDate: { gte: today } } } },
          select: { id: true, memberId: true },
        });
        const thawing = await tx.subscription.findMany({
          where: { status: "FROZEN", NOT: { freezes: { some: { endedEarlyOn: null, startDate: { lte: today }, endDate: { gte: today } } } } },
          select: { id: true, memberId: true },
        });
        if (freezingToday.length) await tx.subscription.updateMany({ where: { id: { in: freezingToday.map((s) => s.id) } }, data: { status: "FROZEN" } });
        if (thawing.length) await tx.subscription.updateMany({ where: { id: { in: thawing.map((s) => s.id) } }, data: { status: "ACTIVE" } });
        const starting = await tx.subscription.findMany({ where: { status: "SCHEDULED", startDate: { lte: today } }, select: { id: true, memberId: true } });
        const ending = await tx.subscription.findMany({ where: { status: "ACTIVE", endDate: { lt: today } }, select: { id: true, memberId: true } });
        if (starting.length) await tx.subscription.updateMany({ where: { id: { in: starting.map((s) => s.id) } }, data: { status: "ACTIVE" } });
        if (ending.length) await tx.subscription.updateMany({ where: { id: { in: ending.map((s) => s.id) } }, data: { status: "EXPIRED" } });
        // PT packages past their validity.
        await tx.memberPtPackage.updateMany({ where: { status: "ACTIVE", validUntil: { lt: today } }, data: { status: "EXPIRED" } });
        const members = [...new Set([...starting, ...ending, ...freezingToday, ...thawing].map((s) => s.memberId))];
        for (const m of members) await this.billing.refreshMemberStatus(tx, m);
        return { started: starting.length, expired: ending.length, frozen: freezingToday.length, thawed: thawing.length };
      });
      if (changed.started || changed.expired || changed.frozen || changed.thawed) {
        this.log.log(`Subscriptions: ${changed.started} started, ${changed.expired} expired, ${changed.frozen} frozen, ${changed.thawed} resumed`);
      }
    } catch (e) {
      this.log.error("Status sweep failed", e instanceof Error ? e.stack : String(e));
    }
  }

  /** After the configured hour (IST) reminders are generated, then anything queued is sent (Cloud API mode). */
  async reminders() {
    try {
      const hourIst = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }).format(new Date()));
      const s = await this.settings.get();
      if (hourIst >= Number(s["reminders.sendAfterHour"] ?? 9) && hourIst < 21) {
        const n = await this.messaging.generate();
        if (n) this.log.log(`Reminders: ${n} queued`);
        await this.messaging.dispatch();
      }
    } catch (e) {
      this.log.error("Reminders failed", e instanceof Error ? e.stack : String(e));
    }
  }
}
