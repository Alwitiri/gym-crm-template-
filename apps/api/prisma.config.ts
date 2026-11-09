import { defineConfig } from "prisma/config";

// Migrations run as the table owner; the app itself connects as the restricted role (DATABASE_URL).
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations", seed: "tsx --env-file=.env prisma/seed.ts" },
  datasource: { url: process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL ?? "" },
});
