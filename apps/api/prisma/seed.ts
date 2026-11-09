/**
 * Demo data for local development. Run with a database owner connection (bypasses RLS):
 *   DATABASE_URL=postgresql://owner:...@localhost/gymcrm npm run seed
 * Every account's password is SEED_PASSWORD (default "Gym@12345678").
 */

import { PrismaPg } from "@prisma/adapter-pg";
import * as argon2 from "argon2";
import { randomBytes } from "node:crypto";
import { PrismaClient } from "../src/generated/prisma/client";
import { PERMISSIONS, SYSTEM_ROLES } from "../src/core/permissions";
import { STARTER_EXERCISES } from "../src/core/exercises";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const PASSWORD = process.env.SEED_PASSWORD ?? "Gym@12345678";

const today = new Date(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()) + "T00:00:00Z");
const day = (offset: number) => new Date(today.getTime() + offset * 86_400_000);
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const fy = (() => { const y = today.getUTCFullYear(), m = today.getUTCMonth() + 1; const s = m >= 4 ? y : y - 1; return `${s}-${String((s + 1) % 100).padStart(2, "0")}`; })();

async function main() {
  if ((await db.business.count()) === 0) await seedPhase1();
  else console.log("Phase 1 demo data already present.");
  await syncPermissions();
  if ((await db.ptPackage.count()) === 0) await seedPhase2();
  else console.log("Phase 2 demo data already present.");
}

/** Adds new permission keys and grants system roles their defaults (never removes anything). */
async function syncPermissions() {
  for (const [key, description] of Object.entries(PERMISSIONS)) {
    await db.permission.upsert({ where: { key }, create: { key, description }, update: {} });
  }
  const perms = new Map((await db.permission.findMany()).map((p) => [p.key, p.id]));
  for (const [key, def] of Object.entries(SYSTEM_ROLES)) {
    const role = await db.role.findUnique({ where: { key } });
    if (!role) continue;
    await db.rolePermission.createMany({ data: def.permissions.map((p) => ({ roleId: role.id, permissionId: perms.get(p)! })), skipDuplicates: true });
  }
}

async function seedPhase1() {
  const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });

  // Permissions & roles
  for (const [key, description] of Object.entries(PERMISSIONS)) {
    await db.permission.upsert({ where: { key }, create: { key, description }, update: { description } });
  }
  const perms = new Map((await db.permission.findMany()).map((p) => [p.key, p.id]));
  const roles: Record<string, string> = {};
  for (const [key, r] of Object.entries(SYSTEM_ROLES)) {
    const role = await db.role.create({
      data: { key, name: r.name, isSystem: true, permissions: { create: r.permissions.map((p) => ({ permissionId: perms.get(p)! })) } },
    });
    roles[key] = role.id;
  }

  await db.business.create({ data: { legalName: "Iron Temple Fitness Pvt Ltd", brandName: "Iron Temple Fitness", gstin: "33ABCDE1234F1Z5", stateCode: "33" } });
  const rsPuram = await db.branch.create({
    data: { code: "CBE-RSP", name: "RS Puram", addressLine1: "42, DB Road, RS Puram", city: "Coimbatore", state: "Tamil Nadu", stateCode: "33", pincode: "641002", phone: "+914222540001" },
  });
  const peelamedu = await db.branch.create({
    data: { code: "CBE-PLM", name: "Peelamedu", addressLine1: "118, Avinashi Road, Peelamedu", city: "Coimbatore", state: "Tamil Nadu", stateCode: "33", pincode: "641004", phone: "+914222570002" },
  });
  for (const b of [rsPuram, peelamedu]) {
    for (let d = 0; d < 7; d++) await db.branchHours.create({ data: { branchId: b.id, dayOfWeek: d, opensAt: d === 0 ? "06:00" : "05:00", closesAt: d === 0 ? "12:00" : "22:00" } });
  }

  // Staff
  let emp = 0;
  async function staff(name: string, email: string, phone: string, branchId: string, designation: string, grants: [string, string | null][], trainer = false) {
    const user = await db.user.create({
      data: {
        displayName: name, email, phone, passwordHash: hash, passwordChangedAt: new Date(),
        roles: { create: grants.map(([role, branch]) => ({ roleId: roles[role], branchId: branch })) },
      },
    });
    const s = await db.staff.create({
      data: { userId: user.id, employeeCode: `EMP-${String(++emp).padStart(4, "0")}`, branchId, designation, isTrainer: trainer, joinedOn: day(-400), specializations: trainer ? ["Strength", "Fat loss"] : [] },
    });
    return { user, staff: s };
  }
  const owner = await staff("Arjun Menon", "owner@irontemple.in", "+919800000001", rsPuram.id, "Owner", [["OWNER", null]]);
  const mgr = await staff("Priya Raman", "manager.rsp@irontemple.in", "+919800000002", rsPuram.id, "Branch manager", [["BRANCH_MANAGER", rsPuram.id]]);
  const recA = await staff("Kavya Suresh", "front.rsp@irontemple.in", "+919800000003", rsPuram.id, "Front desk", [["RECEPTIONIST", rsPuram.id]]);
  const recB = await staff("Dinesh Kumar", "front.plm@irontemple.in", "+919800000004", peelamedu.id, "Front desk", [["RECEPTIONIST", peelamedu.id]]);
  const trainer = await staff("Vikram Nair", "vikram@irontemple.in", "+919800000005", rsPuram.id, "Senior trainer", [["TRAINER", rsPuram.id]], true);
  await staff("Meena Iyer", "accounts@irontemple.in", "+919800000006", rsPuram.id, "Accountant", [["ACCOUNTANT", null]]);

  // Plans
  const plan = async (name: string, durationDays: number, rupees: number, extra: object = {}) =>
    db.membershipPlan.create({ data: { name, durationDays, pricePaise: rupees * 100, registrationFeePaise: 20000, maxDiscountPaise: Math.round(rupees * 10), allBranchAccess: true, facilities: ["GYM_FLOOR", "CARDIO"], ...extra } });
  const monthly = await plan("Monthly", 30, 1500);
  const quarterly = await plan("Quarterly", 90, 4000, { freezeAllowed: true, maxFreezeDays: 15, maxFreezeCount: 1 });
  const half = await plan("Half-yearly", 180, 7000, { freezeAllowed: true, maxFreezeDays: 30, maxFreezeCount: 2 });
  const yearly = await plan("Yearly", 365, 12000, { freezeAllowed: true, maxFreezeDays: 45, maxFreezeCount: 3, facilities: ["GYM_FLOOR", "CARDIO", "STEAM"] });
  await plan("Morning Saver (6–11 AM)", 30, 1000, { accessStartTime: "06:00", accessEndTime: "11:00", allBranchAccess: false, branches: { create: [{ branchId: peelamedu.id }] } });
  const plans = [monthly, quarterly, half, yearly];

  // Members with paid history. Bypasses the API on purpose (seed only), but follows the same rules.
  const first = ["Rahul", "Sneha", "Karthik", "Divya", "Arun", "Lakshmi", "Suresh", "Anjali", "Manoj", "Pooja", "Ganesh", "Nithya", "Prakash", "Revathi", "Sanjay", "Harini", "Vignesh", "Swathi", "Bala", "Keerthana", "Ashwin", "Deepa", "Naveen", "Ramya"];
  const last = ["Krishnan", "Rajan", "Subramanian", "Venkatesh", "Murugan", "Pillai", "Shankar", "Natarajan", "Iyer", "Chandran", "Gopal", "Selvam"];
  await db.$executeRawUnsafe(`INSERT INTO "InvoiceSequence" ("branchId","financialYear","prefix","nextNumber") VALUES ('${rsPuram.id}','${fy}','CBERSP/${fy.slice(2)}/',1),('${peelamedu.id}','${fy}','CBEPLM/${fy.slice(2)}/',1) ON CONFLICT DO NOTHING`);

  let n = 1000;
  for (let i = 0; i < first.length; i++) {
    const branch = i % 3 === 2 ? peelamedu : rsPuram;
    const p = plans[i % plans.length];
    // Spread end dates: some expiring this week, some expired, most active.
    const startOffset = [-25, -100, -170, -300, -40, -29, -88, -380][i % 8];
    const start = day(startOffset);
    const end = day(startOffset + p.durationDays - 1);
    const ended = end < today;
    const createdBy = branch.id === rsPuram.id ? recA.user.id : recB.user.id;
    const member = await db.member.create({
      data: {
        memberCode: `${branch.code}-${String(++n).padStart(6, "0")}`, homeBranchId: branch.id, firstName: first[i], lastName: last[i % last.length],
        phone: `+9198${String(40000000 + i * 7919).padStart(8, "0")}`, email: `${first[i].toLowerCase()}.${last[i % last.length].toLowerCase()}@example.com`,
        gender: i % 2 ? "FEMALE" : "MALE", dateOfBirth: day(-365 * (22 + (i % 15))), city: "Coimbatore",
        qrToken: randomBytes(24).toString("base64url"), joinedOn: start, createdById: createdBy, status: ended ? "EXPIRED" : "ACTIVE",
        createdAt: new Date(start.getTime() + 10 * 3600_000),
      },
    });
    await db.consentRecord.createMany({
      data: [
        { memberId: member.id, purpose: "PRIVACY_NOTICE", granted: true, noticeVersion: "2026-01", channel: "front_desk", recordedById: createdBy, recordedAt: start },
        { memberId: member.id, purpose: "MARKETING_WHATSAPP", granted: i % 4 !== 0, noticeVersion: "2026-01", channel: "front_desk", recordedById: createdBy, recordedAt: start },
      ],
    });
    // Invoice: membership + registration fee, 18% GST split CGST/SGST.
    const items = [
      { itemType: "MEMBERSHIP" as const, description: `${p.name} membership (${ymd(start)} to ${ymd(end)})`, unit: p.pricePaise },
      { itemType: "REGISTRATION_FEE" as const, description: "Registration fee", unit: 20000 },
    ].map((it, idx) => {
      const tax = Math.floor((it.unit * 1800 + 5000) / 10000);
      return { itemType: it.itemType, description: it.description, sacOrHsn: "999723", unitPricePaise: it.unit, taxableValuePaise: it.unit, taxRateBp: 1800, taxPaise: tax, totalPaise: it.unit + tax, sortOrder: idx };
    });
    const subtotal = items.reduce((s, x) => s + x.taxableValuePaise, 0);
    const tax = items.reduce((s, x) => s + x.taxPaise, 0);
    const before = subtotal + tax;
    const roundOff = Math.round(before / 100) * 100 - before;
    const total = before + roundOff;
    const inv = await db.invoice.create({
      data: {
        branchId: branch.id, memberId: member.id, status: "DRAFT", placeOfSupplyStateCode: "33", subtotalPaise: subtotal,
        cgstPaise: Math.floor(tax / 2), sgstPaise: tax - Math.floor(tax / 2), roundOffPaise: roundOff, totalPaise: total, createdById: createdBy,
        items: { create: items }, createdAt: start,
      },
    });
    const [{ num }] = await db.$queryRaw<{ num: string }[]>`SELECT next_invoice_number(${branch.id}::uuid, ${fy}) AS num`;
    await db.invoice.update({ where: { id: inv.id }, data: { status: "ISSUED", invoiceNumber: num, issueDate: start, dueDate: start } });

    const partial = i % 7 === 3; // a few members still owe money
    const paidAmount = partial ? Math.round(total / 2 / 100) * 100 : total;
    const method = (["UPI", "CASH", "CARD", "UPI", "BANK_TRANSFER"] as const)[i % 5];
    const pay = await db.payment.create({
      data: {
        receiptNumber: `RC-${branch.code}-${String(i + 1).padStart(6, "0")}`, branchId: branch.id, memberId: member.id, method, status: "CONFIRMED",
        amountPaise: paidAmount, referenceNumber: method === "CASH" ? null : `REF${100000 + i}`, receivedById: createdBy,
        receivedAt: new Date(start.getTime() + 11 * 3600_000 + i * 60_000),
      },
    });
    await db.paymentAllocation.create({ data: { paymentId: pay.id, invoiceId: inv.id, amountPaise: paidAmount } });
    await db.invoice.update({ where: { id: inv.id }, data: { status: partial ? "PARTIALLY_PAID" : "PAID" } });
    await db.subscription.create({
      data: {
        memberId: member.id, planId: p.id, invoiceId: inv.id, status: ended ? "EXPIRED" : partial ? "PENDING_PAYMENT" : "ACTIVE",
        startDate: start, endDate: end, originalEndDate: end, activatedAt: partial ? null : start,
        planSnapshot: { name: p.name, durationDays: p.durationDays, pricePaise: p.pricePaise },
      },
    });
    if (partial && !ended) await db.member.update({ where: { id: member.id }, data: { status: "PROSPECT" } });
    if (branch.id === rsPuram.id && i % 2 === 0) {
      await db.trainerAssignment.create({ data: { memberId: member.id, trainerId: trainer.staff.id } });
    }
  }
  // Fix sequence so API-created members don't collide with seeded codes.
  await db.$executeRawUnsafe(`SELECT setval('member_code_seq', ${n + 1})`);
  await db.$executeRawUnsafe(`SELECT setval('receipt_no_seq', ${first.length + 1})`);

  // Leads across the pipeline
  const leadNames = ["Aravind S", "Bhavya R", "Charan K", "Dharani M", "Ezhil P", "Farhan A", "Gayathri V", "Hari Prasad", "Indhu L", "Jagan T", "Kiran B", "Lavanya N"];
  const stages = ["NEW", "NEW", "CONTACTED", "CONTACTED", "TRIAL_SCHEDULED", "TRIAL_COMPLETED", "FOLLOW_UP", "FOLLOW_UP", "LOST", "NEW", "CONTACTED", "FOLLOW_UP"] as const;
  const sources = ["WALK_IN", "INSTAGRAM", "WEBSITE", "REFERRAL", "GOOGLE_ADS", "WHATSAPP", "PHONE_CALL", "FACEBOOK"] as const;
  for (let i = 0; i < leadNames.length; i++) {
    const branch = i % 4 === 3 ? peelamedu : rsPuram;
    const lead = await db.lead.create({
      data: {
        branchId: branch.id, name: leadNames[i], phone: `+9197${String(10000000 + i * 3571).padStart(8, "0")}`, source: sources[i % sources.length],
        stage: stages[i], priority: (["LOW", "MEDIUM", "HIGH"] as const)[i % 3], interestedPlanId: plans[i % 4].id,
        assignedToId: branch.id === rsPuram.id ? recA.user.id : recB.user.id,
        nextFollowUpAt: stages[i] === "LOST" ? null : new Date(Date.now() + (i % 5 - 2) * 86_400_000),
        lostReason: stages[i] === "LOST" ? "Joined a gym closer to home" : null,
        createdAt: new Date(Date.now() - (i + 1) * 86_400_000 * 1.5),
      },
    });
    await db.leadActivity.create({ data: { leadId: lead.id, userId: lead.assignedToId!, type: "NOTE", notes: `Enquired about ${plans[i % 4].name} plan.`, occurredAt: lead.createdAt } });
  }

  console.log(`Seeded. Log in as owner@irontemple.in / ${PASSWORD}`);
  console.log(`Other users: manager.rsp@, front.rsp@, front.plm@, vikram@, accounts@ (same password)`);
  void owner; void mgr;
}

/** Phase 2 demo data: PT packages, a second trainer, exercise library, visit history, plans and PT sessions. */
async function seedPhase2() {
  const rsp = await db.branch.findUniqueOrThrow({ where: { code: "CBE-RSP" } });
  const plm = await db.branch.findUniqueOrThrow({ where: { code: "CBE-PLM" } });
  const vikramUser = await db.user.findUniqueOrThrow({ where: { email: "vikram@irontemple.in" }, include: { staff: true } });
  const vikram = vikramUser.staff!;
  const frontRsp = await db.user.findUniqueOrThrow({ where: { email: "front.rsp@irontemple.in" } });
  const trainerRole = await db.role.findUniqueOrThrow({ where: { key: "TRAINER" } });

  // Second trainer, at Peelamedu.
  let ramya = await db.user.findUnique({ where: { email: "ramya@irontemple.in" }, include: { staff: true } });
  if (!ramya) {
    const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    const u = await db.user.create({
      data: { displayName: "Ramya Selvam", email: "ramya@irontemple.in", phone: "+919800000007", passwordHash: hash, passwordChangedAt: new Date(), roles: { create: [{ roleId: trainerRole.id, branchId: plm.id }] } },
    });
    await db.staff.create({ data: { userId: u.id, employeeCode: "EMP-0007", branchId: plm.id, designation: "Trainer", isTrainer: true, specializations: ["Yoga", "Functional training"], joinedOn: day(-200) } });
    ramya = await db.user.findUniqueOrThrow({ where: { id: u.id }, include: { staff: true } });
  }

  if ((await db.exercise.count()) === 0) {
    await db.exercise.createMany({ data: STARTER_EXERCISES.map(([name, muscleGroup, equipment]) => ({ name, muscleGroup, equipment })), skipDuplicates: true });
  }

  const pt10 = await db.ptPackage.create({ data: { name: "PT 10 sessions", sessionCount: 10, validityDays: 45, pricePaise: 500000 } });
  await db.ptPackage.create({ data: { name: "PT 20 sessions", sessionCount: 20, validityDays: 75, pricePaise: 900000 } });
  await db.ptPackage.create({ data: { name: "PT trial session", sessionCount: 1, validityDays: 7, pricePaise: 50000 } });

  // Peelamedu members train with Ramya.
  const plmMembers = await db.member.findMany({ where: { homeBranchId: plm.id } });
  for (const m of plmMembers) {
    if (!(await db.trainerAssignment.findFirst({ where: { memberId: m.id, endedAt: null } }))) {
      await db.trainerAssignment.create({ data: { memberId: m.id, trainerId: ramya.staff!.id } });
    }
  }

  // Visit history for the last 21 days: regulars, occasional and lapsed members.
  const active = await db.member.findMany({ where: { status: "ACTIVE" }, orderBy: { memberCode: "asc" } });
  const now = Date.now();
  let k = 0;
  for (const m of active) {
    const habit = [0.8, 0.55, 0.3, 0.1][k++ % 4];
    for (let d = 21; d >= 1; d--) {
      // deterministic pseudo-random so reruns look the same
      const r = ((k * 9301 + d * 49297) % 233280) / 233280;
      if (r > habit) continue;
      const hour = [6, 7, 7, 8, 18, 19, 19, 20][(k + d) % 8];
      const inAt = new Date(new Date(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(now - d * 86_400_000)) + `T${String(hour).padStart(2, "0")}:${String((k * 7 + d) % 60).padStart(2, "0")}:00+05:30`));
      await db.attendance.create({
        data: { memberId: m.id, branchId: m.homeBranchId, method: (["QR", "QR", "MEMBER_CODE", "PHONE_LOOKUP"] as const)[(k + d) % 4], result: "ALLOWED", checkInAt: inAt, checkOutAt: new Date(inAt.getTime() + (55 + ((k + d) % 40)) * 60_000), operatorId: frontRsp.id },
      });
    }
  }
  // A couple of refusals so the log isn't all green.
  const expired = await db.member.findFirst({ where: { status: "EXPIRED" } });
  if (expired) {
    await db.attendance.create({ data: { memberId: expired.id, branchId: expired.homeBranchId, method: "QR", result: "DENIED", denyReason: "NO_ACTIVE_SUBSCRIPTION", checkInAt: new Date(now - 26 * 3600_000), operatorId: frontRsp.id } });
  }

  // One RS Puram member with a full training setup and an active PT package.
  const star = await db.member.findFirst({ where: { homeBranchId: rsp.id, status: "ACTIVE", trainerAssignments: { some: { trainerId: vikram.id, endedAt: null } } }, orderBy: { memberCode: "asc" } });
  if (star) {
    const ex = new Map((await db.exercise.findMany()).map((e) => [e.name, e.id]));
    const plan = [
      ["Day A: Push", "Barbell bench press", 4, "8-10", 40, 90], ["Day A: Push", "Seated dumbbell press", 3, "10-12", 14, 75], ["Day A: Push", "Triceps pushdown", 3, "12-15", 20, 60],
      ["Day B: Pull", "Lat pulldown", 4, "10-12", 45, 75], ["Day B: Pull", "Seated cable row", 3, "10-12", 40, 75], ["Day B: Pull", "Hammer curl", 3, "12", 10, 60],
      ["Day C: Legs", "Back squat", 4, "6-8", 60, 120], ["Day C: Legs", "Romanian deadlift", 3, "8-10", 50, 90], ["Day C: Legs", "Standing calf raise", 3, "15", 40, 45],
      ["Every day", "Treadmill walk / run", 1, "20 min", null, 0],
    ] as const;
    await db.workoutPlan.create({
      data: {
        memberId: star.id, trainerId: vikram.id, name: "Push / Pull / Legs — 8 weeks", goal: "MUSCLE_GAIN", startDate: day(-14), isActive: true,
        notes: "Add 2.5 kg when all sets hit the top of the rep range. Sleep 7+ hours.",
        exercises: { create: plan.map(([dayLabel, name, sets, reps, w, rest], i) => ({ exerciseId: ex.get(name)!, dayLabel, sets, reps, weightKg: w, restSeconds: rest, sortOrder: i })) },
      },
    });
    await db.dietPlan.create({
      data: {
        memberId: star.id, trainerId: vikram.id, name: "Lean bulk, vegetarian", startDate: day(-14), dailyCalories: 2600, proteinG: 130, carbsG: 330, fatG: 75, preferences: ["VEG"], allergies: [],
        notes: "Drink 3–4 litres of water a day.",
        meals: { create: [
          { mealTime: "07:00", label: "Breakfast", sortOrder: 0, items: [{ food: "Oats with milk and banana", portion: "1 bowl", calories: 450, proteinG: 18 }, { food: "Boiled chana", portion: "1 cup", calories: 270, proteinG: 15 }] },
          { mealTime: "13:00", label: "Lunch", sortOrder: 1, items: [{ food: "Rice", portion: "1.5 cups", calories: 300, proteinG: 6 }, { food: "Dal", portion: "1 cup", calories: 230, proteinG: 14 }, { food: "Paneer bhurji", portion: "150 g", calories: 380, proteinG: 25 }] },
          { mealTime: "17:00", label: "Pre-workout", sortOrder: 2, items: [{ food: "Peanut butter toast", portion: "2 slices", calories: 350, proteinG: 12 }] },
          { mealTime: "20:30", label: "Dinner", sortOrder: 3, items: [{ food: "Chapati", portion: "3", calories: 300, proteinG: 9 }, { food: "Soya chunk curry", portion: "1 cup", calories: 300, proteinG: 28 }, { food: "Curd", portion: "1 cup", calories: 150, proteinG: 9 }] },
        ] },
      },
    });
    for (const [i, w] of [[-28, 78.4], [-14, 78.9], [-1, 79.6]] as const) {
      await db.bodyMetric.create({ data: { memberId: star.id, measuredOn: day(i), weightGrams: Math.round(w * 1000), heightMm: 1760, bodyFatBp: 1850 - (i + 28) * 8, waistMm: 860 - (i + 28) * 2, recordedById: vikramUser.id } });
    }

    // PT package sold 10 days ago, paid by UPI: 4 done, 1 no-show, 3 booked.
    const items = [{ itemType: "PT_PACKAGE" as const, description: `PT 10 sessions with Vikram Nair`, sacOrHsn: "999723", unitPricePaise: 500000, taxableValuePaise: 500000, taxRateBp: 1800, taxPaise: 90000, totalPaise: 590000, sortOrder: 0 }];
    const inv = await db.invoice.create({ data: { branchId: rsp.id, memberId: star.id, status: "DRAFT", placeOfSupplyStateCode: "33", subtotalPaise: 500000, cgstPaise: 45000, sgstPaise: 45000, totalPaise: 590000, createdById: frontRsp.id, items: { create: items }, createdAt: day(-10) } });
    const [{ num }] = await db.$queryRaw<{ num: string }[]>`SELECT next_invoice_number(${rsp.id}::uuid, ${fy}) AS num`;
    await db.invoice.update({ where: { id: inv.id }, data: { status: "ISSUED", invoiceNumber: num, issueDate: day(-10), dueDate: day(-10) } });
    const [{ n }] = await db.$queryRaw<{ n: bigint }[]>`SELECT nextval('receipt_no_seq') AS n`;
    const pay = await db.payment.create({ data: { receiptNumber: `RC-${rsp.code}-${String(n).padStart(6, "0")}`, branchId: rsp.id, memberId: star.id, method: "UPI", status: "CONFIRMED", amountPaise: 590000, referenceNumber: "UPI4471029", receivedById: frontRsp.id, receivedAt: new Date(day(-10).getTime() + 12 * 3600_000) } });
    await db.paymentAllocation.create({ data: { paymentId: pay.id, invoiceId: inv.id, amountPaise: 590000 } });
    await db.invoice.update({ where: { id: inv.id }, data: { status: "PAID" } });
    const mpp = await db.memberPtPackage.create({ data: { memberId: star.id, ptPackageId: pt10.id, trainerId: vikram.id, invoiceId: inv.id, sessionsTotal: 10, sessionsUsed: 5, validFrom: day(-10), validUntil: day(34), status: "ACTIVE" } });
    const slot = (offsetDays: number, hour: number) => new Date(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(now + offsetDays * 86_400_000)) + `T${String(hour).padStart(2, "0")}:00:00+05:30`);
    const past: [number, string][] = [[-9, "COMPLETED"], [-7, "COMPLETED"], [-5, "NO_SHOW"], [-4, "COMPLETED"], [-2, "COMPLETED"]];
    for (const [d, status] of past) {
      const st = slot(d, 7);
      await db.ptSession.create({ data: { memberPtPackageId: mpp.id, memberId: star.id, trainerId: vikram.id, branchId: rsp.id, scheduledStart: st, scheduledEnd: new Date(st.getTime() + 3600_000), status: status as any, countsAgainstPackage: true, completedAt: status === "COMPLETED" ? new Date(st.getTime() + 3600_000) : null, trainerNotes: status === "COMPLETED" ? "Good session. Bench up 2.5 kg." : null } });
    }
    for (const [d, h] of [[0, 18], [2, 7], [4, 7]] as const) {
      const st = slot(d, h);
      await db.ptSession.create({ data: { memberPtPackageId: mpp.id, memberId: star.id, trainerId: vikram.id, branchId: rsp.id, scheduledStart: st, scheduledEnd: new Date(st.getTime() + 3600_000) } });
    }
  }
  console.log("Phase 2 demo data added: PT packages, trainer ramya@irontemple.in, exercise library, 3 weeks of visits, plans and PT sessions.");
}

main().finally(() => db.$disconnect());
