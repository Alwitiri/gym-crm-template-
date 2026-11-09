import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { Db } from "./db.service";

/**
 * Business rules and contact details, stored as key/value rows in BranchSetting (branchId NULL = business-wide).
 * Every key has a typed default, so a fresh install works without any setup.
 */
export const SETTINGS_SCHEMA = z.object({
  "business.phone": z.string().max(20).default(""),
  "business.email": z.string().max(120).default(""),
  "business.website": z.string().max(200).default(""),
  "invoice.footer": z.string().max(500).default("Thank you for training with us."),
  "invoice.terms": z.string().max(1000).default("Membership fees are non-refundable and non-transferable."),
  "checkin.graceDays": z.number().int().min(0).max(15).default(0),
  "reminders.enabled": z.boolean().default(true),
  "reminders.expiryDaysBefore": z.array(z.number().int().min(0).max(30)).max(5).default([7, 3, 0]),
  "reminders.expiryDaysAfter": z.array(z.number().int().min(1).max(60)).max(5).default([1, 7]),
  "reminders.duesEveryDays": z.number().int().min(0).max(30).default(7),
  "reminders.ptDayBefore": z.boolean().default(true),
  "reminders.birthday": z.boolean().default(true),
  "reminders.sendAfterHour": z.number().int().min(6).max(20).default(9),
  "privacy.noticeVersion": z.string().max(20).default("2026-01"),
});
export type Settings = z.infer<typeof SETTINGS_SCHEMA>;
export const SETTINGS_PATCH = SETTINGS_SCHEMA.partial().strict();

@Injectable()
export class SettingsService {
  private cache: { at: number; value: Settings } | null = null;
  constructor(private readonly db: Db) {}

  async get(): Promise<Settings> {
    if (this.cache && Date.now() - this.cache.at < 30_000) return this.cache.value;
    const rows = await this.db.raw.branchSetting.findMany({ where: { branchId: null } });
    const obj: Record<string, unknown> = {};
    for (const r of rows) obj[r.key] = r.value;
    const parsed = SETTINGS_SCHEMA.safeParse(obj);
    const value = parsed.success ? parsed.data : SETTINGS_SCHEMA.parse({});
    this.cache = { at: Date.now(), value };
    return value;
  }

  async set(userId: string, patch: Partial<Settings>) {
    for (const [key, value] of Object.entries(patch)) {
      const existing = await this.db.raw.branchSetting.findFirst({ where: { branchId: null, key } });
      if (existing) await this.db.raw.branchSetting.update({ where: { id: existing.id }, data: { value: value as any, updatedById: userId } });
      else await this.db.raw.branchSetting.create({ data: { key, value: value as any, updatedById: userId } });
    }
    this.cache = null;
    return this.get();
  }

  async business() {
    const b = await this.db.raw.business.findFirst();
    return b ?? { id: null, legalName: "Your Gym", brandName: "Your Gym", gstin: null, pan: null, stateCode: "33", logoFileId: null };
  }
}
