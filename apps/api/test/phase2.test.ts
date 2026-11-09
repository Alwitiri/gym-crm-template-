/**
 * Phase 2 end-to-end tests: check-in, freezes, trainers, workout/diet plans, PT.
 * Needs a running API on a seeded database (see api.test.ts).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

const API = process.env.API_URL ?? "http://localhost:4000/api/v1";
const PW = process.env.SEED_PASSWORD ?? "Gym@12345678";
const uniqPhone = () => "+9195" + String(Math.floor(Math.random() * 1e8)).padStart(8, "0");
const istToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const addDays = (ymd: string, n: number) => { const d = new Date(ymd + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

class Client {
  cookie = ""; csrf = ""; me: any;
  async req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(API + path, {
      method,
      headers: { "content-type": "application/json", ...(this.cookie ? { cookie: this.cookie } : {}), ...(this.csrf && method !== "GET" ? { "x-csrf-token": this.csrf } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0];
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }
  get = (p: string) => this.req("GET", p);
  post = (p: string, b?: unknown, h?: Record<string, string>) => this.req("POST", p, b ?? {}, h);
  put = (p: string, b: unknown) => this.req("PUT", p, b);
  idem = (p: string, b: unknown) => this.req("POST", p, b, { "idempotency-key": randomUUID() });
  async login(email: string) {
    const r = await this.post("/auth/login", { identifier: email, password: PW });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    this.csrf = r.body.csrfToken;
    this.me = (await this.get("/auth/me")).body;
    return this;
  }
}

let owner: Client, mgr: Client, recA: Client, recB: Client, vikram: Client, ramya: Client;
let rsp: any, plm: any, monthly: any, quarterly: any, morning: any, savedHours: Record<string, any[]> = {};

const newMember = (branchId: string) => ({ firstName: "P2", lastName: "Test " + Math.floor(Math.random() * 1e4), phone: uniqPhone(), homeBranchId: branchId, privacyNoticeVersion: "2026-01" });
async function paidMember(c: Client, branchId: string, plan: any) {
  const m = (await c.post("/members", newMember(branchId))).body;
  const q = (await c.post("/checkout/quote", { memberId: m.id, planId: plan.id })).body;
  const sale = await c.idem(`/members/${m.id}/subscriptions`, { planId: plan.id, payment: { method: "CASH", amountPaise: q.totalPaise } });
  assert.equal(sale.status, 201, JSON.stringify(sale.body));
  return { member: (await c.get(`/members/${m.id}`)).body, sale: sale.body };
}

before(async () => {
  [owner, mgr, recA, recB, vikram, ramya] = await Promise.all([
    new Client().login("owner@irontemple.in"), new Client().login("manager.rsp@irontemple.in"),
    new Client().login("front.rsp@irontemple.in"), new Client().login("front.plm@irontemple.in"),
    new Client().login("vikram@irontemple.in"), new Client().login("ramya@irontemple.in"),
  ]);
  const branches = (await owner.get("/branches")).body;
  rsp = branches.find((b: any) => b.code === "CBE-RSP");
  plm = branches.find((b: any) => b.code === "CBE-PLM");
  for (const b of [rsp, plm]) {
    savedHours[b.id] = b.openingHours.map((h: any) => ({ dayOfWeek: h.dayOfWeek, opensAt: h.opensAt, closesAt: h.closesAt }));
    // Open all day so the tests don't depend on the time they run.
    const r = await owner.put(`/branches/${b.id}/hours`, Array.from({ length: 7 }, (_, d) => ({ dayOfWeek: d, opensAt: "00:00", closesAt: "23:59" })));
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }
  const plans = (await owner.get("/membership-plans")).body;
  monthly = plans.find((p: any) => p.name === "Monthly");
  quarterly = plans.find((p: any) => p.name === "Quarterly");
  morning = plans.find((p: any) => p.name.startsWith("Morning Saver"));
});

after(async () => {
  for (const [id, hours] of Object.entries(savedHours)) await owner.put(`/branches/${id}/hours`, hours);
});

describe("check-in", () => {
  let m: any;
  it("lets an active member in by member code, then treats a second scan as already inside", async () => {
    m = (await paidMember(recA, rsp.id, monthly)).member;
    const r = await recA.idem("/attendance/check-in", { credential: m.memberCode });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.result, "ALLOWED");
    assert.match(r.body.message, /^Welcome, P2!/);
    assert.equal(r.body.member.daysRemaining, 30);
    const again = await recA.idem("/attendance/check-in", { credential: m.memberCode });
    assert.equal(again.body.alreadyInside, true);
    assert.equal(again.body.attendanceId, r.body.attendanceId);
    const out = await recA.post(`/attendance/${r.body.attendanceId}/check-out`);
    assert.equal(out.status, 200);
    assert.ok(out.body.checkOutAt);
  });

  it("accepts the QR token and the phone number (auto-detected)", async () => {
    assert.ok(m.qrToken && m.qrToken.length >= 30, "receptionist gets the QR token for the card");
    const byQr = await recA.idem("/attendance/check-in", { credential: m.qrToken });
    assert.equal(byQr.body.result, "ALLOWED");
    await recA.post(`/attendance/${byQr.body.attendanceId}/check-out`);
    const byPhone = await recA.idem("/attendance/check-in", { credential: m.phone.replace("+91", "") });
    assert.equal(byPhone.body.result, "ALLOWED");
  });

  it("refuses unknown cards and expired members, and records every attempt", async () => {
    const unknown = await recA.idem("/attendance/check-in", { credential: "CBE-RSP-999999" });
    assert.equal(unknown.body.result, "DENIED");
    assert.equal(unknown.body.denyReason, "NOT_FOUND");
    const expired = (await owner.get("/members?status=EXPIRED&pageSize=1")).body.data[0];
    const e = await recA.idem("/attendance/check-in", { credential: expired.memberCode });
    assert.equal(e.body.result, "DENIED");
    assert.equal(e.body.denyReason, "NO_ACTIVE_SUBSCRIPTION");
    const log = (await recA.get("/attendance?result=DENIED")).body;
    assert.ok(log.data.some((a: any) => a.id === e.body.attendanceId));
    assert.ok(log.summary.denied >= 2);

    // Receptionist can't override; the branch manager can, with a reason.
    assert.equal((await recA.post(`/attendance/${e.body.attendanceId}/override`, { reason: "Paying renewal now" })).status, 403);
    const ov = await mgr.post(`/attendance/${e.body.attendanceId}/override`, { reason: "Renewing at the desk now" });
    assert.equal(ov.status, 200, JSON.stringify(ov.body));
    assert.equal(ov.body.result, "ALLOWED");
    const audit = (await owner.get(`/audit-logs?entityId=${e.body.attendanceId}`)).body.data[0];
    assert.equal(audit.action, "attendance.override");
  });

  it("checks a multi-branch member in at another branch, but enforces branch-only plans", async () => {
    // RS Puram member on an all-branch plan walks into Peelamedu.
    const visit = await recB.idem("/attendance/check-in", { credential: m.memberCode });
    assert.equal(visit.body.result, "ALLOWED", JSON.stringify(visit.body));
    // Morning Saver is Peelamedu-only.
    const pm = (await paidMember(owner, plm.id, morning)).member;
    const atRsp = await recA.idem("/attendance/check-in", { credential: pm.memberCode });
    assert.equal(atRsp.body.result, "DENIED");
    assert.equal(atRsp.body.denyReason, "BRANCH_NOT_ALLOWED");
    const atPlm = await recB.idem("/attendance/check-in", { credential: pm.memberCode });
    const hhmm = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
    assert.equal(atPlm.body.result, hhmm >= "06:00" && hhmm <= "11:00" ? "ALLOWED" : "DENIED");
    if (atPlm.body.result === "DENIED") assert.equal(atPlm.body.denyReason, "OUTSIDE_ACCESS_HOURS");
  });

  it("respects branch opening hours", async () => {
    await owner.put(`/branches/${rsp.id}/hours`, [{ dayOfWeek: new Date().getDay(), opensAt: "00:00", closesAt: "00:01" }]);
    const fresh = (await paidMember(recA, rsp.id, monthly)).member;
    const r = await recA.idem("/attendance/check-in", { credential: fresh.memberCode });
    await owner.put(`/branches/${rsp.id}/hours`, Array.from({ length: 7 }, (_, d) => ({ dayOfWeek: d, opensAt: "00:00", closesAt: "23:59" })));
    assert.equal(r.body.denyReason, "OUTSIDE_ACCESS_HOURS");
  });

  it("rotating the card invalidates the old QR", async () => {
    const old = m.qrToken;
    const r = await recA.post(`/members/${m.id}/credential/rotate`, {});
    assert.equal(r.status, 200);
    assert.notEqual(r.body.qrToken, old);
    const visit = await recA.idem("/attendance/check-in", { credential: old });
    assert.equal(visit.body.denyReason, "NOT_FOUND");
  });

  it("dashboard counts today's check-ins", async () => {
    const d = (await owner.get("/dashboard")).body;
    assert.ok(d.today.checkIns >= 4);
  });
});

describe("freezing memberships", () => {
  it("freezes a Quarterly membership, pushes the end date and the booked renewal, and blocks entry", async () => {
    const { member } = await paidMember(recA, rsp.id, quarterly);
    const sub = member.currentSubscription;
    assert.equal(sub.freeze.allowed, true);
    assert.equal(sub.freeze.daysLeft, 15);
    // Book the renewal first, so it has to move.
    const q = (await recA.post("/checkout/quote", { memberId: member.id, planId: monthly.id })).body;
    const renewal = (await recA.idem(`/members/${member.id}/subscriptions`, { planId: monthly.id, payment: { method: "CASH", amountPaise: q.totalPaise } })).body.subscription;
    assert.equal(renewal.status, "SCHEDULED");

    const today = istToday();
    const f = await recA.post(`/subscriptions/${sub.id}/freeze`, { startDate: today, endDate: addDays(today, 4), reason: "Travelling" });
    assert.equal(f.status, 200, JSON.stringify(f.body));
    assert.equal(f.body.status, "FROZEN");
    assert.equal(f.body.endDate, addDays(sub.endDate, 5));
    const subs = (await recA.get(`/members/${member.id}/subscriptions`)).body;
    const moved = subs.find((s: any) => s.id === renewal.id);
    assert.equal(moved.startDate, addDays(renewal.startDate, 5));

    const visit = await recA.idem("/attendance/check-in", { credential: member.memberCode });
    assert.equal(visit.body.denyReason, "SUBSCRIPTION_FROZEN");

    const second = await recA.post(`/subscriptions/${sub.id}/freeze`, { startDate: addDays(today, 10), endDate: addDays(today, 11) });
    assert.equal(second.status, 422);
    assert.equal(second.body.code, "FREEZE_LIMIT");

    const un = await recA.post(`/subscriptions/${sub.id}/unfreeze`);
    assert.equal(un.status, 200, JSON.stringify(un.body));
    assert.equal(un.body.status, "ACTIVE");
    assert.equal(un.body.endDate, sub.endDate, "days unused are given back");
    const back = (await recA.get(`/members/${member.id}/subscriptions`)).body.find((s: any) => s.id === renewal.id);
    assert.equal(back.startDate, renewal.startDate);
    const ok = await recA.idem("/attendance/check-in", { credential: member.memberCode });
    assert.equal(ok.body.result, "ALLOWED");
  });

  it("refuses to freeze a plan that doesn't allow it, or for too long", async () => {
    const { member } = await paidMember(recA, rsp.id, monthly);
    const r = await recA.post(`/subscriptions/${member.currentSubscription.id}/freeze`, { startDate: istToday(), endDate: addDays(istToday(), 2) });
    assert.equal(r.body.code, "FREEZE_NOT_ALLOWED");
    const q = (await paidMember(recA, rsp.id, quarterly)).member;
    const long = await recA.post(`/subscriptions/${q.currentSubscription.id}/freeze`, { startDate: addDays(istToday(), 1), endDate: addDays(istToday(), 20) });
    assert.equal(long.body.code, "FREEZE_LIMIT");
  });
});

describe("trainers, workouts and diet", () => {
  let member: any, vikramId: string;
  it("assigns a trainer, who then sees the member", async () => {
    member = (await paidMember(recA, rsp.id, monthly)).member;
    const trainers = (await recA.get("/trainers")).body;
    vikramId = trainers.find((t: any) => t.displayName === "Vikram Nair").id;
    assert.equal((await vikram.get(`/members/${member.id}`)).status, 404, "not his member yet");
    const r = await recA.put(`/members/${member.id}/trainer`, { trainerId: vikramId });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await vikram.get(`/members/${member.id}`)).status, 200);
    assert.equal((await ramya.get(`/members/${member.id}`)).status, 404, "other branch's trainer can't see them");
  });

  it("trainer writes a workout plan; receptionists can't", async () => {
    const lib = (await vikram.get("/exercises")).body;
    const squat = lib.find((e: any) => e.name === "Back squat");
    const bench = lib.find((e: any) => e.name === "Barbell bench press");
    const body = {
      name: "Beginner full body", goal: "GENERAL", startDate: istToday(),
      exercises: [{ exerciseId: squat.id, dayLabel: "Day A", sets: 3, reps: "10", weightKg: 30, restSeconds: 90 }, { exerciseId: bench.id, dayLabel: "Day A", sets: 3, reps: "10", weightKg: 25 }],
    };
    assert.equal((await recA.post(`/members/${member.id}/workout-plans`, body)).status, 403);
    const r = await vikram.post(`/members/${member.id}/workout-plans`, body);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.exercises.length, 2);
    assert.equal(r.body.trainerName, "Vikram Nair");
    const other = (await recA.get("/members?pageSize=100")).body.data.find((x: any) => x.id !== member.id);
    const notMine = await vikram.post(`/members/${other.id}/workout-plans`, body);
    assert.ok([404].includes(notMine.status) || (await vikram.get(`/members/${other.id}`)).status === 200);
    // Receptionist can read it.
    const plans = (await recA.get(`/members/${member.id}/workout-plans`)).body;
    assert.equal(plans[0].name, "Beginner full body");
  });

  it("trainer writes a diet plan and records measurements", async () => {
    const d = await vikram.post(`/members/${member.id}/diet-plans`, {
      name: "Fat loss, non-veg", startDate: istToday(), dailyCalories: 1900, proteinG: 120, preferences: ["NON_VEG"],
      meals: [{ mealTime: "08:00", label: "Breakfast", items: [{ food: "Egg whites", portion: "4", calories: 70, proteinG: 14 }] }],
    });
    assert.equal(d.status, 201, JSON.stringify(d.body));
    const mt = await vikram.post(`/members/${member.id}/body-metrics`, { measuredOn: istToday(), weightKg: 82.4, waistCm: 92 });
    assert.equal(mt.status, 201, JSON.stringify(mt.body));
    const list = (await recA.get(`/members/${member.id}/body-metrics`)).body;
    assert.equal(list.at(-1).weightKg, 82.4);
  });
});

describe("personal training", () => {
  let member: any, pkg: any, vikramId: string;
  it("sells a PT package with GST and activates it when paid", async () => {
    member = (await paidMember(recA, rsp.id, monthly)).member;
    vikramId = (await recA.get("/trainers")).body.find((t: any) => t.displayName === "Vikram Nair").id;
    pkg = (await recA.get("/pt-packages?status=ACTIVE")).body.find((p: any) => p.name === "PT 10 sessions");
    const q = (await recA.post(`/members/${member.id}/pt-packages/quote`, { ptPackageId: pkg.id, trainerId: vikramId })).body;
    assert.equal(q.totalPaise, 590000);
    const r = await recA.idem(`/members/${member.id}/pt-packages`, { ptPackageId: pkg.id, trainerId: vikramId, payment: { method: "UPI", amountPaise: 590000, referenceNumber: "UPI-PT-1" } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.ptPackage.status, "ACTIVE");
    assert.equal(r.body.invoice.status, "PAID");
    pkg = r.body.ptPackage;
    assert.equal((await vikram.get(`/members/${member.id}`)).status, 200, "buying PT assigns the trainer");
  });

  it("books sessions and refuses to double-book the trainer", async () => {
    const at = new Date(Date.now() + 3 * 86_400_000);
    at.setUTCHours(1, 30, 0, 0); // 07:00 IST
    const s = await recA.post("/pt-sessions", { memberPtPackageId: pkg.id, scheduledStart: at.toISOString() });
    assert.equal(s.status, 201, JSON.stringify(s.body));
    const other = (await paidMember(recA, rsp.id, monthly)).member;
    const p2 = (await recA.idem(`/members/${other.id}/pt-packages`, { ptPackageId: pkg.ptPackageId, trainerId: vikramId, payment: { method: "CASH", amountPaise: 590000 } })).body.ptPackage;
    const clash = await recA.post("/pt-sessions", { memberPtPackageId: p2.id, scheduledStart: new Date(at.getTime() + 30 * 60_000).toISOString() });
    assert.equal(clash.status, 409);
    assert.equal(clash.body.code, "TRAINER_UNAVAILABLE");
    // Member cancels 3 days ahead: session goes back to the package.
    const c = await recA.post(`/pt-sessions/${s.body.id}/cancel`, { by: "MEMBER" });
    assert.equal(c.body.countsAgainstPackage, false);
  });

  it("late cancellation by the member uses the session; completing one uses it too", async () => {
    const soon = await recA.post("/pt-sessions", { memberPtPackageId: pkg.id, scheduledStart: new Date(Date.now() + 2 * 3600_000).toISOString() });
    assert.equal(soon.status, 201, JSON.stringify(soon.body));
    const late = await vikram.post(`/pt-sessions/${soon.body.id}/cancel`, { by: "MEMBER", reason: "Called 2 hours before" });
    assert.equal(late.status, 200, JSON.stringify(late.body));
    assert.equal(late.body.countsAgainstPackage, true);

    const now = await recA.post("/pt-sessions", { memberPtPackageId: pkg.id, scheduledStart: new Date(Date.now() - 20 * 60_000).toISOString() });
    assert.equal(now.status, 201, JSON.stringify(now.body));
    assert.equal((await recA.post(`/pt-sessions/${now.body.id}/complete`, {})).status, 403, "only trainers mark sessions done");
    const done = await vikram.post(`/pt-sessions/${now.body.id}/complete`, { trainerNotes: "Form check on squats" });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    const pk = (await recA.get(`/members/${member.id}/pt-packages`)).body[0];
    assert.equal(pk.sessionsUsed, 2);
    assert.equal(pk.sessionsLeft, 8);
  });

  it("a trainer only sees their own PT sessions", async () => {
    const v = (await vikram.get(`/pt-sessions?from=${addDays(istToday(), -14)}&to=${addDays(istToday(), 14)}`)).body.data;
    assert.ok(v.length > 0);
    assert.ok(v.every((s: any) => s.trainerName === "Vikram Nair"));
    const r = (await ramya.get(`/pt-sessions?from=${addDays(istToday(), -14)}&to=${addDays(istToday(), 14)}`)).body.data;
    assert.ok(r.every((s: any) => s.trainerName === "Ramya Selvam"));
  });
});
