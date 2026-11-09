/**
 * End-to-end API tests. Needs a running API on a freshly seeded database:
 *   API_URL=http://localhost:4000/api/v1 npm test
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, describe, it } from "node:test";

const API = process.env.API_URL ?? "http://localhost:4000/api/v1";
const PW = process.env.SEED_PASSWORD ?? "Gym@12345678";
const uniqPhone = () => "+9196" + String(Math.floor(Math.random() * 1e8)).padStart(8, "0");

class Client {
  cookie = "";
  csrf = "";
  me: any;
  async req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(API + path, {
      method,
      headers: {
        "content-type": "application/json",
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...(this.csrf && method !== "GET" ? { "x-csrf-token": this.csrf } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0];
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }
  get = (p: string) => this.req("GET", p);
  post = (p: string, b?: unknown, h?: Record<string, string>) => this.req("POST", p, b ?? {}, h);
  patch = (p: string, b: unknown) => this.req("PATCH", p, b);
  async login(email: string, password = PW) {
    const r = await this.post("/auth/login", { identifier: email, password });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    this.csrf = r.body.csrfToken;
    this.me = (await this.get("/auth/me")).body;
    return this;
  }
}

let owner: Client, recA: Client, recB: Client, trainer: Client, accountant: Client;
let rsp: any, plm: any, monthly: any, quarterly: any;

before(async () => {
  [owner, recA, recB, trainer, accountant] = await Promise.all([
    new Client().login("owner@irontemple.in"),
    new Client().login("front.rsp@irontemple.in"),
    new Client().login("front.plm@irontemple.in"),
    new Client().login("vikram@irontemple.in"),
    new Client().login("accounts@irontemple.in"),
  ]);
  const branches = (await owner.get("/branches")).body;
  rsp = branches.find((b: any) => b.code === "CBE-RSP");
  plm = branches.find((b: any) => b.code === "CBE-PLM");
  const plans = (await owner.get("/membership-plans")).body;
  monthly = plans.find((p: any) => p.name === "Monthly");
  quarterly = plans.find((p: any) => p.name === "Quarterly");
});

const newMember = (branchId: string, extra: object = {}) => ({
  firstName: "Test", lastName: "Member " + Math.floor(Math.random() * 1000), phone: uniqPhone(), homeBranchId: branchId,
  privacyNoticeVersion: "2026-01", marketingConsents: ["MARKETING_WHATSAPP"], ...extra,
});

describe("auth & session security", () => {
  it("rejects a wrong password with a generic message", async () => {
    const r = await new Client().post("/auth/login", { identifier: "owner@irontemple.in", password: "wrong-password" });
    assert.equal(r.status, 401);
    assert.equal(r.body.code, "INVALID_CREDENTIALS");
  });

  it("rejects unknown users the same way", async () => {
    const r = await new Client().post("/auth/login", { identifier: "nobody@example.com", password: "whatever-123" });
    assert.equal(r.status, 401);
    assert.equal(r.body.code, "INVALID_CREDENTIALS");
  });

  it("requires a session", async () => {
    const r = await new Client().get("/members");
    assert.equal(r.status, 401);
  });

  it("blocks state-changing requests without the CSRF token", async () => {
    const c = Object.assign(new Client(), { cookie: owner.cookie });
    const r = await c.post("/leads", { name: "No Csrf", phone: uniqPhone(), branchId: rsp.id, source: "WALK_IN" });
    assert.equal(r.status, 403);
    assert.equal(r.body.code, "CSRF_FAILED");
  });

  it("returns problem+json without stack traces", async () => {
    const r = await owner.get("/members/not-a-uuid");
    assert.equal(r.status, 400);
    assert.ok(!JSON.stringify(r.body).includes("at "), "no stack trace");
  });

  it("logout revokes the session server-side", async () => {
    const c = await new Client().login("manager.rsp@irontemple.in");
    const saved = c.cookie;
    assert.equal((await c.post("/auth/logout")).status, 204);
    const again = Object.assign(new Client(), { cookie: saved });
    assert.equal((await again.get("/auth/me")).status, 401);
  });
});

describe("branch isolation and role limits", () => {
  it("receptionist sees only their branch's members", async () => {
    const r = await recA.get("/members?pageSize=100");
    assert.equal(r.status, 200);
    assert.ok(r.body.total > 0);
    assert.ok(r.body.data.every((m: any) => m.homeBranchId === rsp.id));
  });

  it("other-branch member returns 404, not 403", async () => {
    const plmMember = (await recB.get("/members?pageSize=1")).body.data[0];
    const r = await recA.get(`/members/${plmMember.id}`);
    assert.equal(r.status, 404);
  });

  it("branchId filter cannot widen scope", async () => {
    const r = await recA.get(`/members?branchId=${plm.id}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.total, 0);
  });

  it("receptionist cannot register members at another branch", async () => {
    const r = await recA.post("/members", newMember(plm.id));
    assert.equal(r.status, 403);
  });

  it("owner sees revenue on the dashboard, receptionist does not", async () => {
    const o = (await owner.get("/dashboard?period=this_month")).body;
    const r = (await recA.get("/dashboard?period=this_month")).body;
    assert.ok(o.revenue && typeof o.revenue.collectedPaise === "number");
    assert.equal(o.revenueSeries.length, 30);
    assert.equal(r.revenue, undefined);
    assert.ok(o.members.total > r.members.total, "owner counts all branches");
  });

  it("trainer only sees members assigned to them", async () => {
    const r = await trainer.get("/members?pageSize=100");
    assert.equal(r.status, 200);
    assert.ok(r.body.total > 0 && r.body.total < (await recA.get("/members?pageSize=1")).body.total);
    const unassigned = (await recA.get("/members?pageSize=100")).body.data.find((m: any) => !r.body.data.some((x: any) => x.id === m.id));
    assert.equal((await trainer.get(`/members/${unassigned.id}`)).status, 404);
  });

  it("trainer and accountant cannot register members", async () => {
    assert.equal((await trainer.post("/members", newMember(rsp.id))).status, 403);
    assert.equal((await accountant.post("/members", newMember(rsp.id))).status, 403);
  });

  it("audit log is owner-only", async () => {
    assert.equal((await recA.get("/audit-logs")).status, 403);
    const r = await owner.get("/audit-logs?action=auth.login");
    assert.equal(r.status, 200);
    assert.ok(r.body.data.length > 0);
  });
});

describe("members, sales and payments", () => {
  let member: any;

  it("registers a member and records consent", async () => {
    const r = await recA.post("/members", newMember(rsp.id, { phone: "98765 12345".replace("12345", String(10000 + Math.floor(Math.random() * 89999))) }));
    assert.equal(r.status, 201, JSON.stringify(r.body));
    member = r.body;
    assert.match(member.memberCode, /^CBE-RSP-\d{6}$/);
    assert.match(member.phone, /^\+919876/);
    assert.equal(member.status, "PROSPECT");
    assert.equal(member.consents.PRIVACY_NOTICE.granted, true);
    assert.equal(member.consents.MARKETING_WHATSAPP.granted, true);
    assert.equal(member.consents.MARKETING_SMS.granted, false);
  });

  it("flags duplicates by phone", async () => {
    const r = await recA.post("/members", newMember(rsp.id, { phone: member.phone }));
    assert.equal(r.status, 409);
    assert.equal(r.body.code, "POSSIBLE_DUPLICATE");
    assert.equal(r.body.candidates[0].id, member.id);
  });

  it("quotes GST exactly: ₹1,500 + ₹200 registration + 18% = ₹2,006", async () => {
    const r = await recA.post("/checkout/quote", { memberId: member.id, planId: monthly.id });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.subtotalPaise, 170000);
    assert.equal(r.body.cgstPaise + r.body.sgstPaise, 30600);
    assert.equal(r.body.cgstPaise, 15300);
    assert.equal(r.body.totalPaise, 200600);
  });

  it("caps a receptionist's discount at the plan limit", async () => {
    const r = await recA.post("/checkout/quote", { memberId: member.id, planId: monthly.id, discountPaise: 50000 });
    assert.equal(r.status, 403);
  });

  it("requires an idempotency key for sales", async () => {
    const r = await recA.post(`/members/${member.id}/subscriptions`, { planId: monthly.id });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, "IDEMPOTENCY_KEY_REQUIRED");
  });

  let firstSale: any;
  it("sells a membership with UPI: invoice issued, paid, membership active", async () => {
    const key = randomUUID();
    const body = { planId: monthly.id, payment: { method: "UPI", amountPaise: 200600, referenceNumber: "UPI123456" } };
    const r = await recA.post(`/members/${member.id}/subscriptions`, body, { "idempotency-key": key });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    firstSale = r.body;
    assert.equal(r.body.subscription.status, "ACTIVE");
    assert.equal(r.body.invoice.status, "PAID");
    assert.match(r.body.invoice.invoiceNumber, /^CBERSP\/\d{2}-\d{2}\/\d{5}$/);
    assert.equal(r.body.payment.unallocatedPaise, 0);

    // Same key + same body = same result, no second sale.
    const retry = await recA.post(`/members/${member.id}/subscriptions`, body, { "idempotency-key": key });
    assert.equal(retry.body.invoice.id, r.body.invoice.id);
    const subs = (await recA.get(`/members/${member.id}/subscriptions`)).body;
    assert.equal(subs.length, 1);

    // Same key + different body is rejected.
    const misuse = await recA.post(`/members/${member.id}/subscriptions`, { planId: quarterly.id }, { "idempotency-key": key });
    assert.equal(misuse.status, 409);
    assert.equal(misuse.body.code, "IDEMPOTENCY_KEY_REUSED");

    const m = (await recA.get(`/members/${member.id}`)).body;
    assert.equal(m.status, "ACTIVE");
    assert.equal(m.duesPaise, 0);
  });

  it("requires a reference number for UPI", async () => {
    const r = await recA.post(`/members/${member.id}/subscriptions`, { planId: monthly.id, payment: { method: "UPI", amountPaise: 177000 } }, { "idempotency-key": randomUUID() });
    assert.equal(r.status, 422);
    assert.equal(r.body.code, "REFERENCE_REQUIRED");
  });

  it("early renewal starts the day after the current one ends, without registration fee", async () => {
    const r = await recA.post(`/members/${member.id}/subscriptions`, { planId: monthly.id, payment: { method: "CASH", amountPaise: 177000 } }, { "idempotency-key": randomUUID() });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const prevEnd = new Date(firstSale.subscription.endDate + "T00:00:00Z");
    const expectedStart = new Date(prevEnd.getTime() + 86_400_000).toISOString().slice(0, 10);
    assert.equal(r.body.subscription.startDate, expectedStart);
    assert.equal(r.body.subscription.status, "SCHEDULED");
    assert.equal(r.body.subscription.previousSubscriptionId, firstSale.subscription.id);
    assert.equal(r.body.invoice.totalPaise, 177000); // 1500 + 18% = 1770, no registration
  });

  it("rejects a start date that overlaps the live membership", async () => {
    const r = await recA.post(`/members/${member.id}/subscriptions`, { planId: monthly.id, startDate: firstSale.subscription.endDate }, { "idempotency-key": randomUUID() });
    assert.equal(r.status, 422);
    assert.equal(r.body.code, "SUBSCRIPTION_OVERLAP");
  });

  it("partial payment leaves the membership pending until the balance is paid", async () => {
    const m = (await recA.post("/members", newMember(rsp.id))).body;
    const sale = await recA.post(`/members/${m.id}/subscriptions`, { planId: monthly.id, payment: { method: "CASH", amountPaise: 100000 } }, { "idempotency-key": randomUUID() });
    assert.equal(sale.status, 201, JSON.stringify(sale.body));
    assert.equal(sale.body.subscription.status, "PENDING_PAYMENT");
    assert.equal(sale.body.invoice.status, "PARTIALLY_PAID");
    let detail = (await recA.get(`/members/${m.id}`)).body;
    assert.equal(detail.duesPaise, 100600);

    // Overpaying the balance: the API caps allocation to what is due.
    const pay = await recA.post("/payments", { memberId: m.id, method: "CASH", amountPaise: 100600 }, { "idempotency-key": randomUUID() });
    assert.equal(pay.status, 201, JSON.stringify(pay.body));
    detail = (await recA.get(`/members/${m.id}`)).body;
    assert.equal(detail.duesPaise, 0);
    assert.equal(detail.status, "ACTIVE");
    assert.equal(detail.currentSubscription.status, "ACTIVE");

    const nothing = await recA.post("/payments", { memberId: m.id, method: "CASH", amountPaise: 500 }, { "idempotency-key": randomUUID() });
    assert.equal(nothing.status, 422);
    assert.equal(nothing.body.code, "NOTHING_DUE");
  });

  it("writes before/after values to the audit log on edits", async () => {
    const r = await recA.patch(`/members/${member.id}`, { city: "Pollachi" });
    assert.equal(r.status, 200);
    const log = (await owner.get(`/audit-logs?entityId=${member.id}&action=member.update`)).body.data[0];
    assert.equal(log.after.city, "Pollachi");
    assert.equal(log.userName, "Kavya Suresh");
  });

  it("payments list totals by method", async () => {
    const r = await accountant.get("/payments?period=today");
    assert.equal(r.status, 200);
    assert.ok(r.body.totalsByMethod.CASH >= 100000 + 100600);
    assert.ok(r.body.totalsByMethod.UPI >= 200600);
  });
});

describe("leads", () => {
  let lead: any;
  it("creates a lead and catches duplicates", async () => {
    const phone = uniqPhone();
    const r = await recA.post("/leads", { name: "Ramesh Babu", phone, branchId: rsp.id, source: "INSTAGRAM", interestedPlanId: quarterly.id, notes: "Wants evening slot" });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    lead = r.body;
    assert.equal(lead.stage, "NEW");
    const dup = await recA.post("/leads", { name: "Ramesh B", phone, branchId: rsp.id, source: "WALK_IN" });
    assert.equal(dup.status, 409);
  });

  it("logging a call moves NEW → CONTACTED", async () => {
    await recA.post(`/leads/${lead.id}/activities`, { type: "CALL", notes: "Interested, will visit Saturday" });
    const r = (await recA.get(`/leads/${lead.id}`)).body;
    assert.equal(r.stage, "CONTACTED");
    assert.ok(r.activities.some((a: any) => a.type === "STAGE_CHANGE" && a.toStage === "CONTACTED"));
  });

  it("LOST needs a reason", async () => {
    const r = await recA.post(`/leads/${lead.id}/stage`, { stage: "LOST" });
    assert.equal(r.status, 422);
  });

  it("pipeline returns counts per stage", async () => {
    const r = (await recA.get("/leads")).body;
    assert.ok(r.stageCounts.CONTACTED >= 1);
    assert.ok(r.data.every((l: any) => l.branchId === rsp.id));
  });

  it("converts a lead into a paid member in one step", async () => {
    const r = await recA.post(`/leads/${lead.id}/convert`, {
      member: { privacyNoticeVersion: "2026-01", marketingConsents: [] },
      planId: quarterly.id,
      payment: { method: "CARD", amountPaise: 495600, referenceNumber: "POS-7781" },
    }, { "idempotency-key": randomUUID() });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.subscription.status, "ACTIVE");
    assert.equal(r.body.invoice.totalPaise, 495600); // (4000 + 200) × 1.18
    const l = (await recA.get(`/leads/${lead.id}`)).body;
    assert.equal(l.stage, "CONVERTED");
    assert.equal(l.convertedMemberId, r.body.member.id);
    const again = await recA.post(`/leads/${lead.id}/convert`, { member: { privacyNoticeVersion: "2026-01" } }, { "idempotency-key": randomUUID() });
    assert.equal(again.status, 409);
  });

  it("other branch can't touch this lead", async () => {
    assert.equal((await recB.get(`/leads/${lead.id}`)).status, 404);
    assert.equal((await recB.post(`/leads/${lead.id}/stage`, { stage: "FOLLOW_UP" })).status, 404);
  });
});

describe("brute-force protection", () => {
  it("locks the account after 5 wrong passwords", async () => {
    const c = new Client();
    for (let i = 0; i < 5; i++) await c.post("/auth/login", { identifier: "accounts@irontemple.in", password: "bad-" + i });
    const r = await c.post("/auth/login", { identifier: "accounts@irontemple.in", password: PW });
    assert.equal(r.status, 423);
    assert.equal(r.body.code, "ACCOUNT_LOCKED");
  });
});
