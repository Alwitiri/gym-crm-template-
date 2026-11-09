/**
 * First-time setup of a real (non-demo) installation. Runs once, as the database owner.
 *
 *   1. creates the restricted login the app uses (row-level security applies to it),
 *   2. adds roles and permissions,
 *   3. creates the business, the first branch and the owner's account.
 *
 * Everything else (plans, staff, more branches, settings) is done by the owner in the app.
 * Refuses to run if a business already exists, so it can't overwrite real data.
 *
 * Settings come from environment variables (see deploy/env.prod.example):
 *   MIGRATE_DATABASE_URL, APP_DB_PASSWORD,
 *   GYM_NAME, GYM_LEGAL_NAME, GYM_GSTIN, GYM_STATE_CODE, GYM_STATE,
 *   BRANCH_CODE, BRANCH_NAME, BRANCH_ADDRESS, BRANCH_CITY, BRANCH_PINCODE, BRANCH_PHONE,
 *   OWNER_NAME, OWNER_EMAIL, OWNER_PHONE
 * The owner's first password is printed once; they change it under My account.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import * as argon2 from "argon2";
import { randomBytes } from "node:crypto";
import { Client } from "pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { PERMISSIONS, SYSTEM_ROLES } from "../src/core/permissions";

const env = (k: string, fallback?: string) => {
  const v = process.env[k]?.trim() || fallback;
  if (!v) { console.error(`Missing ${k}. Fill it in deploy/.env.prod and run again.`); process.exit(1); }
  return v;
};
const phone = (p: string) => (p.startsWith("+") ? p : "+91" + p.replace(/\D/g, "").slice(-10));

async function ensureAppRole(url: string, password: string) {
  const c = new Client({ connectionString: url });
  await c.connect();
  const db = (await c.query("SELECT current_database() AS d")).rows[0].d as string;
  const owner = (await c.query("SELECT current_user AS u")).rows[0].u as string;
  const exists = (await c.query("SELECT 1 FROM pg_roles WHERE rolname = 'gym_app'")).rowCount;
  const pw = password.replace(/'/g, "''");
  await c.query(exists ? `ALTER ROLE gym_app WITH LOGIN PASSWORD '${pw}'` : `CREATE ROLE gym_app LOGIN PASSWORD '${pw}' NOSUPERUSER NOBYPASSRLS`);
  for (const sql of [
    `GRANT CONNECT ON DATABASE "${db}" TO gym_app`,
    `GRANT USAGE ON SCHEMA public TO gym_app`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO gym_app`,
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO gym_app`,
    `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO gym_app`,
    `REVOKE UPDATE, DELETE ON "AuditLog", "ConsentRecord", "PaymentAllocation", "CreditNote" FROM gym_app`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE "${owner}" IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO gym_app`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE "${owner}" IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO gym_app`,
  ]) await c.query(sql);
  await c.end();
  console.log(exists ? "App login gym_app: password updated, permissions refreshed" : "App login gym_app created");
}

async function main() {
  const url = env("MIGRATE_DATABASE_URL");
  await ensureAppRole(url, env("APP_DB_PASSWORD"));
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    if ((await db.business.count()) > 0) {
      console.log("A business already exists — nothing else to do. (This script never changes existing data.)");
      return;
    }
    for (const [key, description] of Object.entries(PERMISSIONS)) await db.permission.upsert({ where: { key }, create: { key, description }, update: {} });
    const perms = new Map((await db.permission.findMany()).map((p) => [p.key, p.id]));
    const roles: Record<string, string> = {};
    for (const [key, r] of Object.entries(SYSTEM_ROLES)) {
      const role = (await db.role.findUnique({ where: { key } })) ?? (await db.role.create({ data: { key, name: r.name, isSystem: true } }));
      await db.rolePermission.createMany({ data: r.permissions.map((p) => ({ roleId: role.id, permissionId: perms.get(p)! })), skipDuplicates: true });
      roles[key] = role.id;
    }
    const stateCode = env("GYM_STATE_CODE", "33");
    const gstin = process.env.GYM_GSTIN?.trim().toUpperCase() || null;
    await db.business.create({ data: { brandName: env("GYM_NAME"), legalName: env("GYM_LEGAL_NAME", process.env.GYM_NAME), gstin, stateCode } });
    const branch = await db.branch.create({
      data: {
        code: env("BRANCH_CODE").toUpperCase().slice(0, 10), name: env("BRANCH_NAME"), addressLine1: env("BRANCH_ADDRESS"), city: env("BRANCH_CITY"),
        state: env("GYM_STATE", "Tamil Nadu"), stateCode, pincode: env("BRANCH_PINCODE"), phone: process.env.BRANCH_PHONE ? phone(process.env.BRANCH_PHONE) : null,
      },
    });
    for (let d = 0; d < 7; d++) await db.branchHours.create({ data: { branchId: branch.id, dayOfWeek: d, opensAt: d === 0 ? "06:00" : "05:00", closesAt: d === 0 ? "12:00" : "22:00" } });
    const password = randomBytes(9).toString("base64url") + "@7";
    const user = await db.user.create({
      data: {
        displayName: env("OWNER_NAME"), email: env("OWNER_EMAIL").toLowerCase(), phone: phone(env("OWNER_PHONE")),
        passwordHash: await argon2.hash(password, { type: argon2.argon2id }), passwordChangedAt: new Date(),
        roles: { create: [{ roleId: roles.OWNER, branchId: null }] },
      },
    });
    await db.staff.create({ data: { userId: user.id, employeeCode: "EMP-0001", branchId: branch.id, designation: "Owner", joinedOn: new Date(new Date().toISOString().slice(0, 10)) } });
    console.log("\nSetup complete.");
    console.log(`  Business: ${process.env.GYM_NAME}   Branch: ${branch.name} (${branch.code})`);
    console.log(`  Owner sign-in: ${user.email}`);
    console.log(`  First password: ${password}`);
    console.log("  Sign in, change this password under My account, then add plans, staff and settings.\n");
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
