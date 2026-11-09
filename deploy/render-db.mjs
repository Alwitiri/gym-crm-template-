// Prints the database URL the app should use on Render.
// If GYM_DB_NAME is set, the CRM gets its own database inside the same Postgres server
// (created here if missing), so it never touches another app's tables.
import { createRequire } from "node:module";
const require = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { Client } = require("pg");

const base = process.env.DATABASE_URL;
const name = process.env.GYM_DB_NAME?.trim();
if (!base) { console.error("DATABASE_URL is not set"); process.exit(1); }
if (!name) { process.stdout.write(base); process.exit(0); }
if (!/^[a-z_][a-z0-9_]{0,62}$/.test(name)) { console.error("GYM_DB_NAME must be lowercase letters, digits and _"); process.exit(1); }

const ssl = /render\.com|sslmode=require/.test(base) ? { rejectUnauthorized: false } : undefined;
const c = new Client({ connectionString: base, ssl });
await c.connect();
const exists = (await c.query("SELECT 1 FROM pg_database WHERE datname = $1", [name])).rowCount > 0;
if (!exists) {
  try {
    await c.query(`CREATE DATABASE "${name}"`);
    console.error(`Created database ${name}`);
  } catch (e) {
    console.error(`Could not create database ${name}: ${e.message}. Stopping so no other app's database is changed.`);
    process.exit(1);
  }
}
await c.end();
const u = new URL(base);
u.pathname = "/" + name;
process.stdout.write(u.toString());
