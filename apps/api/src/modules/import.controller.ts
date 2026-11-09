import { Body, Controller, HttpCode, Post, Query } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { AuditService } from "../core/audit.service";
import { CurrentScope, Requires } from "../core/auth";
import { addDays, dbDate, financialYear, istDate } from "../core/dates";
import { Db, inScope, Scope } from "../core/db.service";
import { forbidden, notFound } from "../core/errors";
import type { Permission } from "../core/permissions";
import { normalisePhone, Zod, zUuid } from "../core/validation";

type S = Scope & { permission: Permission };

const row = z.object({
  firstName: z.string().optional(), lastName: z.string().optional(), phone: z.union([z.string(), z.number()]).optional(), email: z.string().optional(),
  gender: z.string().optional(), dateOfBirth: z.union([z.string(), z.number()]).optional(), joinedOn: z.union([z.string(), z.number()]).optional(),
  planName: z.string().optional(), startDate: z.union([z.string(), z.number()]).optional(), endDate: z.union([z.string(), z.number()]).optional(), amountDue: z.union([z.string(), z.number()]).optional(),
}).passthrough();
const body = z.object({ branchId: zUuid, rows: z.array(row).min(1).max(3000) });

/** Accepts 2026-11-07, 07-11-2026, 07/11/2026, 7/11/26 and Excel serial numbers. */
function parseDate(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "number" || /^\d{5}$/.test(String(v))) {
    const d = new Date(Date.UTC(1899, 11, 30) + Number(v) * 86_400_000);
    return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) return valid(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  return null;
}
function valid(y: number, mo: number, d: number) {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? dt.toISOString().slice(0, 10) : null;
}
const GENDER: Record<string, string> = { m: "MALE", male: "MALE", f: "FEMALE", female: "FEMALE", o: "OTHER", other: "OTHER" };

interface Checked { row: number; ok: boolean; errors: string[]; warnings: string[]; name: string; phone: string; plan: string | null; status: string | null; endDate: string | null; duePaise: number }

@Controller("imports")
export class ImportController {
  constructor(private readonly db: Db, private readonly audit: AuditService) {}

  /**
   * Bring members over from a register or spreadsheet. Always call with dryRun=true first:
   * nothing is saved and every row comes back with its problems. Then send the same rows with dryRun=false.
   * Rows with errors are skipped; duplicates (same phone) are never created twice.
   * No consent is invented for imported members: they're asked for it the next time they visit.
   */
  @Post("members")
  @HttpCode(200)
  @Requires("members.import")
  async members(@CurrentScope() scope: S, @Query("dryRun") dryRun: string | undefined, @Body(new Zod(body)) b: z.infer<typeof body>) {
    if (!inScope(scope.branchIds, b.branchId)) throw forbidden("You can't import into that branch");
    const branch = await this.db.raw.branch.findUnique({ where: { id: b.branchId } });
    if (!branch) throw notFound("Branch");
    const plans = await this.db.raw.membershipPlan.findMany();
    const today = istDate();
    const existingPhones = new Set((await this.db.run({ userId: scope.userId, branchIds: "*" }, (tx) => tx.member.findMany({ where: { deletedAt: null }, select: { phone: true } }))).map((m) => m.phone));
    const seen = new Set<string>();

    const checked: (Checked & { data?: any })[] = b.rows.map((r, i) => {
      const errors: string[] = [], warnings: string[] = [];
      const firstName = String(r.firstName ?? "").trim();
      const phone = normalisePhone(String(r.phone ?? ""));
      if (!firstName) errors.push("First name is missing");
      if (!/^\+[1-9]\d{7,14}$/.test(phone)) errors.push("Mobile number is missing or not valid");
      else if (existingPhones.has(phone)) errors.push("Already a member with this mobile number");
      else if (seen.has(phone)) errors.push("Same mobile number appears earlier in the file");
      seen.add(phone);
      const email = String(r.email ?? "").trim().toLowerCase();
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) warnings.push("Email ignored (not valid)");
      const dob = parseDate(r.dateOfBirth);
      if (r.dateOfBirth && !dob) warnings.push("Date of birth ignored (unreadable)");
      const joined = parseDate(r.joinedOn) ?? parseDate(r.startDate) ?? today;
      let plan = null as (typeof plans)[number] | null, start: string | null = null, end: string | null = null, status: string | null = null;
      if (r.planName) {
        plan = plans.find((p) => p.name.toLowerCase() === String(r.planName).trim().toLowerCase()) ?? null;
        if (!plan) errors.push(`Plan "${r.planName}" doesn't exist. Use one of: ${plans.filter((p) => p.status === "ACTIVE").map((p) => p.name).join(", ")}`);
        end = parseDate(r.endDate);
        start = parseDate(r.startDate) ?? (end && plan ? addDays(end, -(plan.durationDays - 1)) : null);
        if (plan && !end) errors.push("Membership end date is missing or unreadable");
        if (start && end && end < start) errors.push("End date is before start date");
        if (start && end) status = end < today ? "EXPIRED" : start > today ? "SCHEDULED" : "ACTIVE";
      }
      const dueRupees = Number(String(r.amountDue ?? "0").replace(/[^\d.]/g, "")) || 0;
      if (dueRupees > 500000) errors.push("Amount due looks too large");
      return {
        row: i + 2, ok: errors.length === 0, errors, warnings, name: [firstName, r.lastName].filter(Boolean).join(" "), phone,
        plan: plan?.name ?? null, status, endDate: end, duePaise: Math.round(dueRupees * 100),
        data: { firstName, lastName: String(r.lastName ?? "").trim() || null, phone, email: email && warnings.every((w) => !w.startsWith("Email")) ? email : null, gender: GENDER[String(r.gender ?? "").trim().toLowerCase()] ?? null, dob, joined, plan, start, end, status },
      };
    });

    const summary = {
      total: checked.length, ready: checked.filter((c) => c.ok).length, withErrors: checked.filter((c) => !c.ok).length,
      activeMemberships: checked.filter((c) => c.ok && c.status === "ACTIVE").length,
      expiredMemberships: checked.filter((c) => c.ok && c.status === "EXPIRED").length,
      openingDuesPaise: checked.filter((c) => c.ok).reduce((s, c) => s + c.duePaise, 0),
    };
    const rows = checked.map(({ data, ...c }) => c);
    if (dryRun !== "false") return { dryRun: true, summary, rows };

    let created = 0;
    const fy = financialYear(today);
    await this.db.run(scope, async (tx) => {
      await tx.$executeRaw`INSERT INTO "InvoiceSequence" ("branchId","financialYear","prefix","nextNumber") VALUES (${branch.id}::uuid, ${fy}, ${branch.code.replace(/-/g, "") + "/" + fy.slice(2) + "/"}, 1) ON CONFLICT DO NOTHING`;
      for (const c of checked) {
        if (!c.ok) continue;
        const d = c.data;
        const [{ n }] = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('member_code_seq') AS n`;
        const m = await tx.member.create({
          data: {
            memberCode: `${branch.code}-${String(n).padStart(6, "0")}`, homeBranchId: branch.id, firstName: d.firstName, lastName: d.lastName, phone: d.phone,
            email: d.email, gender: d.gender, dateOfBirth: d.dob ? dbDate(d.dob) : null, joinedOn: dbDate(d.joined), qrToken: randomBytes(24).toString("base64url"),
            createdById: scope.userId, status: d.status === "ACTIVE" ? "ACTIVE" : d.status === "EXPIRED" ? "EXPIRED" : "PROSPECT",
          },
        });
        if (d.plan) {
          await tx.subscription.create({
            data: {
              memberId: m.id, planId: d.plan.id, status: d.status, startDate: dbDate(d.start), endDate: dbDate(d.end), originalEndDate: dbDate(d.end),
              activatedAt: new Date(), planSnapshot: { name: d.plan.name, durationDays: d.plan.durationDays, pricePaise: d.plan.pricePaise, imported: true, freezeAllowed: d.plan.freezeAllowed, maxFreezeDays: d.plan.maxFreezeDays, maxFreezeCount: d.plan.maxFreezeCount, allBranchAccess: d.plan.allBranchAccess },
            },
          });
        }
        if (c.duePaise > 0) {
          // Opening balance carried over from the old system: outside GST (already invoiced there).
          const inv = await tx.invoice.create({
            data: {
              branchId: branch.id, memberId: m.id, status: "DRAFT", placeOfSupplyStateCode: branch.stateCode, subtotalPaise: c.duePaise, totalPaise: c.duePaise, createdById: scope.userId,
              notes: "Opening balance from previous records",
              items: { create: [{ itemType: "OTHER", description: "Opening balance (previous system)", unitPricePaise: c.duePaise, taxableValuePaise: c.duePaise, taxRateBp: 0, taxPaise: 0, totalPaise: c.duePaise }] },
            },
          });
          const [{ num }] = await tx.$queryRaw<{ num: string }[]>`SELECT next_invoice_number(${branch.id}::uuid, ${fy}) AS num`;
          await tx.invoice.update({ where: { id: inv.id }, data: { status: "ISSUED", invoiceNumber: num, issueDate: dbDate(today), dueDate: dbDate(today) } });
        }
        created++;
      }
      await this.audit.log(tx, { userId: scope.userId, branchId: branch.id, action: "members.import", entityType: "Member", metadata: { ...summary, created } });
    }, 120_000);
    return { dryRun: false, summary: { ...summary, created }, rows };
  }
}
