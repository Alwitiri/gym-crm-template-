import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { Db } from "../core/db.service";
import { MessagingService } from "./messaging.service";
import { PERMISSIONS, SYSTEM_ROLES } from "../core/permissions";
import { STARTER_EXERCISES } from "../core/exercises";

/**
 * Keeps the database in step with the code after an upgrade:
 * - new permission keys are added to the catalogue,
 * - system roles gain any default permission they are missing (nothing is ever removed),
 * - an empty exercise library gets the starter set.
 * Idempotent; runs on every start.
 */
@Injectable()
export class BootstrapService implements OnApplicationBootstrap {
  private readonly log = new Logger("Bootstrap");
  constructor(private readonly db: Db, private readonly messaging: MessagingService) {}

  async onApplicationBootstrap() {
    try {
      const db = this.db.raw;
      const existing = new Map((await db.permission.findMany()).map((p) => [p.key, p.id]));
      let added = 0;
      for (const [key, description] of Object.entries(PERMISSIONS)) {
        if (!existing.has(key)) {
          const p = await db.permission.create({ data: { key, description } });
          existing.set(key, p.id);
          added++;
        }
      }
      let granted = 0;
      for (const [key, def] of Object.entries(SYSTEM_ROLES)) {
        const role = await db.role.findUnique({ where: { key }, include: { permissions: true } });
        if (!role) continue; // roles are created by the seed / first-run setup
        const have = new Set(role.permissions.map((rp) => rp.permissionId));
        const missing = def.permissions.map((p) => existing.get(p)!).filter((id) => id && !have.has(id));
        if (missing.length) {
          await db.rolePermission.createMany({ data: missing.map((permissionId) => ({ roleId: role.id, permissionId })), skipDuplicates: true });
          granted += missing.length;
        }
      }
      if ((await db.exercise.count()) === 0) {
        await db.exercise.createMany({ data: STARTER_EXERCISES.map(([name, muscleGroup, equipment]) => ({ name, muscleGroup, equipment })), skipDuplicates: true });
        this.log.log(`Added ${STARTER_EXERCISES.length} exercises to the library`);
      }
      if ((await db.expenseCategory.count()) === 0) {
        await db.expenseCategory.createMany({ data: ["Rent", "Salaries", "Electricity", "Water & internet", "Equipment", "Repairs & maintenance", "Marketing", "Housekeeping", "Supplements & stock", "Other"].map((name) => ({ name })), skipDuplicates: true });
      }
      await this.messaging.ensureTemplates();
      if (added || granted) this.log.log(`Permissions: ${added} new, ${granted} granted to system roles`);
    } catch (e) {
      this.log.error("Startup sync failed", e instanceof Error ? e.stack : String(e));
    }
  }
}
