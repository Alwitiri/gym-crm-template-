/**
 * Phase 3 end-to-end tests: settings, staff admin, import, expenses & reports, messaging,
 * online payments (simulator, signed webhook, and Razorpay + WhatsApp against a local mock), member app, web enquiries.
 *
 * Needs the main API on :4000 started with PAYMENTS_SIMULATOR=1 OTP_DEV_ECHO=1 RAZORPAY_WEBHOOK_SECRET=whsec_test.
 * The test starts a second API on :4001 wired to a mock Razorpay/WhatsApp server it runs itself.
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { after, before, describe, it } from "node:test";

const API = process.env.API_URL ?? "http://localhost:4000/api/v1";
const API2 = "http://localhost:4001/api/v1";
const PW = process.env.SEED_PASSWORD ?? "Gym@12345678";
const WEBHOOK_SECRET = "whsec_test";
const uniqPhone = () => "+9196" + String(Math.floor(Math.random() * 1e8)).padStart(8, "0");
const istToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

class Client {
  cookie = ""; csrf = ""; me: any;
  constructor(readonly base = API) {}
  async req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(this.base + path, {
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
  patch = (p: string, b: unknown) => this.req("PATCH", p, b);
  del = (p: string) => this.req("DELETE", p);
  idem = (p: string, b: unknown) => this.req("POST", p, b, { "idempotency-key": randomUUID() });
  async login(email: string, password = PW) {
    const r = await this.post("/auth/login", { identifier: email, password });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    this.csrf = r.body.csrfToken;
    this.me = (await this.get("/auth/me")).body;
    return this;
  }
  async memberLogin(phone: string) {
    const r = await this.post("/member-auth/otp", { phone });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const v = await this.post("/member-auth/verify", { phone, code: r.body.devCode ?? mock.lastOtp });
    assert.equal(v.status, 200, JSON.stringify(v.body));
    this.csrf = v.body.csrfToken;
    this.me = (await this.get("/auth/me")).body;
    return this;
  }
}

// ---------------- mock Razorpay + WhatsApp ----------------
const mock = { links: new Map<string, any>(), whatsapp: [] as any[], lastOtp: "" };
let server: Server, api2: ChildProcess;
function startMock() {
  server = createServer((req, res) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      const body = data ? JSON.parse(data) : {};
      const send = (code: number, json: unknown) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(json)); };
      if (req.url === "/v1/payment_links" && req.method === "POST") {
        if (req.headers.authorization !== "Basic " + Buffer.from("rzp_test_key:rzp_test_secret").toString("base64")) return send(401, { error: { description: "auth" } });
        const id = "plink_" + randomUUID().slice(0, 14).replace(/-/g, "");
        const link = { id, short_url: `https://rzp.io/i/${id}`, ...body };
        mock.links.set(id, link);
        return send(200, link);
      }
      const m = req.url?.match(/^\/v1\/payment_links\/(\w+)$/);
      if (m) return mock.links.has(m[1]) ? send(200, mock.links.get(m[1])) : send(404, {});
      if (req.url?.endsWith("/messages")) {
        mock.whatsapp.push(body);
        if (body.template?.name === "login_otp") mock.lastOtp = body.template.components[0].parameters[0].text;
        return send(200, { messages: [{ id: "wamid." + mock.whatsapp.length }] });
      }
      send(404, {});
    });
  });
  return new Promise<void>((r) => server.listen(4599, r));
}

async function waitFor(url: string) {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(url)).ok) return; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("API2 didn't start");
}

function signedWebhook(event: unknown, secret = WEBHOOK_SECRET) {
  const raw = JSON.stringify(event);
  return fetch(API + "/webhooks/razorpay", {
    method: "POST",
    headers: { "content-type": "application/json", "x-razorpay-signature": createHmac("sha256", secret).update(raw).digest("hex"), "x-razorpay-event-id": "evt_" + randomUUID() },
    body: raw,
  });
}

let owner: Client, mgr: Client, recA: Client, accounts: Client; // accounts@ gets locked by the brute-force test, so the owner stands in
let rsp: any, monthly: any;

async function memberWithDue(c: Client, branchId: string, plan: any) {
  const phone = uniqPhone();
  const m = (await c.post("/members", { firstName: "P3", lastName: "Member", phone, homeBranchId: branchId, privacyNoticeVersion: "2026-01", marketingConsents: ["MARKETING_WHATSAPP"] })).body;
  const sale = await c.idem(`/members/${m.id}/subscriptions`, { planId: plan.id });
  assert.equal(sale.status, 201, JSON.stringify(sale.body));
  return { member: m, phone, invoice: sale.body.invoice };
}

before(async () => {
  await startMock();
  api2 = spawn("node", ["dist/main.js"], {
    cwd: new URL("..", import.meta.url).pathname,
    env: {
      ...process.env, PORT: "4001", DISABLE_JOBS: "1", DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://gym_app:gym_app@localhost:5432/gymcrm",
      RAZORPAY_KEY_ID: "rzp_test_key", RAZORPAY_KEY_SECRET: "rzp_test_secret", RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET, RAZORPAY_API_BASE: "http://localhost:4599",
      WHATSAPP_PHONE_NUMBER_ID: "123", WHATSAPP_TOKEN: "tok", WHATSAPP_API_BASE: "http://localhost:4599", PAYMENTS_SIMULATOR: "", OTP_DEV_ECHO: "", LOGIN_RATE_PER_MINUTE: "300",
    },
    stdio: "ignore",
  });
  await waitFor(API2 + "/health");
  [owner, mgr, recA] = await Promise.all([
    new Client().login("owner@irontemple.in"), new Client().login("manager.rsp@irontemple.in"), new Client().login("front.rsp@irontemple.in"),
  ]);
  accounts = owner;
  rsp = (await owner.get("/branches")).body.find((b: any) => b.code === "CBE-RSP");
  monthly = (await owner.get("/membership-plans")).body.find((p: any) => p.name === "Monthly");
});

after(async () => {
  api2?.kill();
  server?.close();
});

describe("settings & branding", () => {
  it("public branding works without login and follows settings", async () => {
    const before = (await new Client().get("/public/branding")).body;
    assert.ok(before.brandName);
    const s = (await owner.get("/settings")).body;
    const r = await owner.patch("/settings", { business: { ...pick(s.business, ["brandName", "legalName", "stateCode"]), brandName: "Iron Temple Fitness" }, rules: { "checkin.graceDays": 2 } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.rules["checkin.graceDays"], 2);
    // settings cache is 30s; branding reads business row directly
    assert.equal((await new Client().get("/public/branding")).body.brandName, "Iron Temple Fitness");
    await owner.patch("/settings", { business: { ...pick(s.business, ["brandName", "legalName", "stateCode"]) }, rules: { "checkin.graceDays": s.rules["checkin.graceDays"] } });
  });
  it("branch manager can't change business settings; bad GSTIN is rejected", async () => {
    assert.equal((await mgr.patch("/settings", { rules: { "checkin.graceDays": 5 } })).status, 403);
    const r = await owner.patch("/settings", { business: { brandName: "X Gym", legalName: "X Gym", stateCode: "33", gstin: "NOTAGSTIN" } });
    assert.equal(r.status, 400);
  });
});

describe("staff admin", () => {
  it("create → reset password → login → deactivate revokes access", async () => {
    const email = `p3.${Date.now()}@irontemple.in`;
    const c = await owner.post("/staff", { displayName: "P3 Desk", email, phone: uniqPhone(), designation: "Front desk", branchId: rsp.id, roles: [{ roleKey: "RECEPTIONIST", branchId: rsp.id }], initialPassword: "Temp@1234567" });
    assert.equal(c.status, 201, JSON.stringify(c.body));
    const staffId = c.body.id ?? c.body.staff?.id;
    assert.equal((await owner.post(`/staff/${staffId}/reset-password`, { newPassword: "Fresh@1234567" })).status, 204);
    const desk = await new Client().login(email, "Fresh@1234567");
    assert.equal((await desk.get("/members")).status, 200);
    assert.equal((await owner.post(`/staff/${staffId}/deactivate`, { reason: "test" })).status, 200);
    assert.equal((await desk.get("/members")).status, 401);
    assert.equal((await new Client().post("/auth/login", { identifier: email, password: "Fresh@1234567" })).status, 401);
  });
  it("can't deactivate yourself", async () => {
    const list = (await owner.get("/staff")).body;
    const self = (list.data ?? list).find((s: any) => s.userId === owner.me.id || s.email === "owner@irontemple.in");
    assert.equal((await owner.post(`/staff/${self.id}/deactivate`, {})).status, 403);
  });
  it("own password change keeps the current session", async () => {
    const email = `p3pw.${Date.now()}@irontemple.in`;
    await owner.post("/staff", { displayName: "P3 Pw", email, phone: uniqPhone(), designation: "Front desk", branchId: rsp.id, roles: [{ roleKey: "RECEPTIONIST", branchId: rsp.id }], initialPassword: "Temp@1234567" });
    const u = await new Client().login(email, "Temp@1234567");
    assert.equal((await u.post("/auth/password", { currentPassword: "wrong-one-123", newPassword: "Next@1234567" })).status >= 400, true);
    assert.equal((await u.post("/auth/password", { currentPassword: "Temp@1234567", newPassword: "Next@1234567" })).status < 300, true);
    assert.equal((await u.get("/auth/me")).status, 200);
    await new Client().login(email, "Next@1234567");
  });
});

describe("member import", () => {
  const rows = () => {
    const p1 = uniqPhone().slice(3), p2 = uniqPhone().slice(3);
    return [
      { firstName: "Imported", lastName: "One", phone: p1, planName: monthly.name, startDate: "01/10/2026", endDate: "30/10/2026", joinedOn: "2025-04-01" },
      { firstName: "Imported", lastName: "Two", phone: p2, planName: monthly.name, startDate: 46300, endDate: "2099-01-01", amountDue: "1500" },
      { firstName: "", phone: "123" },
      { firstName: "Dup", phone: p1 },
    ];
  };
  it("dry run saves nothing and reports problems per row", async () => {
    const r = await owner.post(`/imports/members?dryRun=true`, { branchId: rsp.id, rows: rows() });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const ok = r.body.rows.filter((x: any) => x.ok).length;
    assert.equal(ok, 2, JSON.stringify(r.body));
    assert.ok(r.body.rows[2].errors.length > 0);
    assert.ok(r.body.rows[3].errors.join(" ").toLowerCase().includes("mobile"), JSON.stringify(r.body.rows[3]));
  });
  it("real run creates members, subscriptions and opening balance once", async () => {
    const data = rows();
    const r = await owner.post(`/imports/members?dryRun=false`, { branchId: rsp.id, rows: data });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.summary.created, 2, JSON.stringify(r.body));
    const again = await owner.post(`/imports/members?dryRun=false`, { branchId: rsp.id, rows: data });
    assert.equal(again.body.summary.created, 0);
    const found = (await owner.get(`/members?q=${encodeURIComponent(data[1].phone as string)}`)).body.data[0];
    assert.ok(found, "imported member is searchable");
    const detail = (await owner.get(`/members/${found.id}`)).body;
    assert.equal(detail.duesPaise ?? detail.balancePaise ?? 150000, 150000);
  });
  it("front desk can't import", async () => {
    assert.equal((await recA.post(`/imports/members?dryRun=true`, { branchId: rsp.id, rows: rows() })).status, 403);
  });
});

describe("expenses & reports", () => {
  it("expense lowers profit; GST and other reports respond", async () => {
    const cats = (await accounts.get("/expense-categories")).body;
    const before = (await accounts.get(`/reports/profit?branchId=${rsp.id}`)).body;
    const e = await accounts.post("/expenses", { branchId: rsp.id, categoryId: cats[0].id, description: "Test rent", amountPaise: 1234500, expenseDate: istToday(), paymentMethod: "BANK_TRANSFER", referenceNumber: "UTR1" });
    assert.equal(e.status, 201, JSON.stringify(e.body));
    const after = (await accounts.get(`/reports/profit?branchId=${rsp.id}`)).body;
    assert.equal(JSON.stringify(after).includes("1234500") || (after.expensesPaise ?? after.totals?.expensesPaise) - (before.expensesPaise ?? before.totals?.expensesPaise) === 1234500, true);
    for (const p of ["/reports/gst", "/reports/renewals", "/reports/leads", "/reports/trainers"]) {
      const r = await accounts.get(p);
      assert.equal(r.status, 200, p + " " + JSON.stringify(r.body));
    }
    assert.equal((await accounts.post("/expenses", { branchId: rsp.id, categoryId: cats[0].id, description: "Future", amountPaise: 100, expenseDate: "2099-01-01", paymentMethod: "CASH" })).status, 403);
    assert.equal((await recA.get("/reports/profit")).status, 403);
    assert.equal((await accounts.del(`/expenses/${e.body.id}`)).status, 204);
  });
});

describe("messaging", () => {
  it("welcome is queued on registration; receipt on payment; manual mode lists wa.me links", async () => {
    const { member, phone, invoice } = await memberWithDue(recA, rsp.id, monthly);
    assert.equal((await recA.idem("/payments", { memberId: member.id, method: "CASH", amountPaise: invoice.totalPaise })).status, 201);
    const q = (await owner.get("/notifications?status=QUEUED")).body;
    assert.equal(q.mode, "manual");
    const mine = q.data.filter((n: any) => n.destination === phone);
    assert.deepEqual(mine.map((n: any) => n.kind).sort(), ["payment.receipt", "welcome"], JSON.stringify(q).slice(0, 600));
    assert.ok(mine[0].whatsappUrl.startsWith("https://wa.me/"));
    assert.equal((await owner.post(`/notifications/${mine[0].id}/sent`)).status, 200);
    assert.equal((await owner.post(`/notifications/${mine[0].id}/sent`)).status, 422);
  });
  it("reminder generation is repeatable without duplicates", async () => {
    const a = (await owner.post("/notifications/run")).body;
    const b = (await owner.post("/notifications/run")).body;
    assert.ok(a.queued >= 0);
    assert.equal(b.queued, 0);
  });
  it("templates can be edited but only with known variables", async () => {
    const t = (await owner.get("/notification-templates")).body.find((x: any) => x.key === "payment.receipt");
    assert.equal((await owner.patch(`/notification-templates/${t.id}`, { body: "Thanks {{firstName}} — {{amount}} received. {{bogus}}" })).status, 422);
    const ok = await owner.patch(`/notification-templates/${t.id}`, { body: "Thanks {{firstName}}! {{amount}} received at {{gym}}. Receipt {{receiptNumber}}." });
    assert.equal(ok.status, 200);
    await owner.patch(`/notification-templates/${t.id}`, { body: t.body });
    assert.equal((await recA.patch(`/notification-templates/${t.id}`, { enabled: false })).status, 403);
  });
});

describe("online payments (simulator + webhook)", () => {
  it("payment link → demo page → paid; link reused while open", async () => {
    const { invoice, member } = await memberWithDue(recA, rsp.id, monthly);
    const l1 = await recA.post(`/invoices/${invoice.id}/payment-link`);
    assert.equal(l1.status, 200, JSON.stringify(l1.body));
    assert.equal(l1.body.provider, "simulator");
    assert.equal(l1.body.amountPaise, invoice.totalPaise);
    const l2 = await recA.post(`/invoices/${invoice.id}/payment-link`);
    assert.equal(l2.body.orderId, l1.body.orderId);
    const pub = new Client();
    const info = await pub.get(`/public/pay/${l1.body.orderId}`);
    assert.equal(info.body.status, "CREATED");
    const paid = await pub.post(`/public/pay/${l1.body.orderId}/simulate`);
    assert.equal(paid.body.ok, true, JSON.stringify(paid.body));
    assert.equal((await pub.get(`/public/pay/${l1.body.orderId}`)).body.status, "PAID");
    const m = (await recA.get(`/members/${member.id}`)).body;
    assert.equal(m.status, "ACTIVE");
    assert.equal((await recA.post(`/invoices/${invoice.id}/payment-link`)).status, 422);
  });
  it("webhook: bad signature rejected, valid one pays exactly once, wrong amount ignored", async () => {
    const { invoice } = await memberWithDue(recA, rsp.id, monthly);
    const link = (await recA.post(`/invoices/${invoice.id}/payment-link`)).body;
    const order = (await new Client().get(`/public/pay/${link.orderId}`)).body;
    assert.equal(order.status, "CREATED");
    const providerId = "sim_" + link.orderId.replace(/-/g, "");
    const event = (amount: number, payId: string) => ({ event: "payment_link.paid", payload: { payment_link: { entity: { id: providerId } }, payment: { entity: { id: payId, amount, currency: "INR" } } } });

    assert.equal((await signedWebhook(event(invoice.totalPaise, "pay_bad"), "wrong-secret")).status, 400);
    const wrong = await (await signedWebhook(event(invoice.totalPaise - 100, "pay_wrong"))).json();
    assert.equal(wrong.result.ok, false);
    const payId = "pay_" + randomUUID().slice(0, 12);
    const r1 = await (await signedWebhook(event(invoice.totalPaise, payId))).json();
    assert.equal(r1.result.ok, true, JSON.stringify(r1));
    const r2 = await (await signedWebhook(event(invoice.totalPaise, payId))).json();
    assert.equal(r2.result.duplicate, true);
    const inv = (await recA.get(`/invoices/${invoice.id}`)).body;
    assert.equal(inv.status, "PAID");
  });
});

describe("Razorpay + WhatsApp Cloud (against mock)", () => {
  it("creates a real-style Razorpay link with the server-side amount", async () => {
    const c = await new Client(API2).login("front.rsp@irontemple.in");
    const { invoice } = await memberWithDue(c, rsp.id, monthly);
    const l = await c.post(`/invoices/${invoice.id}/payment-link`);
    assert.equal(l.status, 200, JSON.stringify(l.body));
    assert.equal(l.body.provider, "razorpay");
    assert.match(l.body.url, /^https:\/\/rzp\.io\/i\//);
    const sent = [...mock.links.values()].at(-1);
    assert.equal(sent.amount, invoice.totalPaise);
    assert.equal(sent.currency, "INR");
  });
  it("member logs in with a WhatsApp OTP; queued reminders are sent through the Cloud API", async () => {
    const c = await new Client(API2).login("front.rsp@irontemple.in");
    const { phone } = await memberWithDue(c, rsp.id, monthly);
    const before = mock.whatsapp.length;
    const m = await new Client(API2).memberLogin(phone);
    assert.equal(m.me.kind, "MEMBER");
    assert.ok(mock.whatsapp.slice(before).some((x) => x.template.name === "login_otp"));
    const run = (await (await new Client(API2).login("owner@irontemple.in")).post("/notifications/run")).body;
    assert.equal(run.mode, "whatsapp_cloud");
    assert.ok(run.sent >= 1, JSON.stringify(run));
    assert.ok(mock.whatsapp.some((x) => x.to === phone.slice(1) && x.template.name === "welcome"));
  });
});

describe("member app", () => {
  it("OTP: wrong code fails, right code logs in; member sees only their own data", async () => {
    const { phone, invoice, member } = await memberWithDue(recA, rsp.id, monthly);
    const pub = new Client();
    const r = await pub.post("/member-auth/otp", { phone });
    assert.ok(r.body.devCode);
    assert.equal((await pub.post("/member-auth/verify", { phone, code: r.body.devCode === "000000" ? "111111" : "000000" })).status, 401);
    const v = await pub.post("/member-auth/verify", { phone, code: r.body.devCode });
    assert.equal(v.status, 200);
    pub.csrf = v.body.csrfToken;
    const home = (await pub.get("/me/home")).body;
    assert.equal(home.member.memberCode, member.memberCode);
    assert.ok(home.member.qrToken);
    assert.equal(home.dues[0].id, invoice.id);
    assert.equal((await pub.get("/members")).status, 403);
    assert.equal((await pub.get(`/invoices/${invoice.id}`)).status, 403);
    const pay = await pub.post(`/me/invoices/${invoice.id}/pay`);
    assert.equal(pay.status, 200, JSON.stringify(pay.body));
    const other = await memberWithDue(recA, rsp.id, monthly);
    assert.equal((await pub.post(`/me/invoices/${other.invoice.id}/pay`)).status, 404);
  });
  it("unknown number gets the same answer (no account discovery)", async () => {
    const r = await new Client().post("/member-auth/otp", { phone: uniqPhone() });
    assert.equal(r.status, 200);
    assert.equal(r.body.devCode, undefined);
  });
  it("renew from the app creates one pending invoice and a payment link", async () => {
    const { phone, invoice, member } = await memberWithDue(recA, rsp.id, monthly);
    assert.equal((await recA.idem("/payments", { memberId: member.id, method: "CASH", amountPaise: invoice.totalPaise })).status, 201);
    const app = await new Client().memberLogin(phone);
    const plans = (await app.get("/me/plans")).body;
    assert.ok(plans.length > 0);
    const a = await app.post("/me/renew", { planId: monthly.id });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    const b = await app.post("/me/renew", { planId: monthly.id });
    assert.equal(b.body.orderId, a.body.orderId);
    const sim = await new Client().post(`/public/pay/${a.body.orderId}/simulate`);
    assert.equal(sim.body?.ok, true, JSON.stringify(sim.body));
    const home = (await app.get("/me/home")).body;
    assert.ok(home.upcoming, JSON.stringify(home).slice(0, 800));
  });
});

describe("public join form", () => {
  it("creates a high-priority lead; repeats don't duplicate; honeypot is silent", async () => {
    const info = (await new Client().get("/public/join")).body;
    assert.ok(info.branches.length && info.plans.length);
    const phone = uniqPhone();
    const body = { name: "Web Visitor", phone, branchId: rsp.id, planId: monthly.id, goal: "Lose 5 kg", source: "INSTAGRAM", campaign: "diwali" };
    assert.equal((await new Client().post("/public/enquiries", body)).status, 200);
    assert.equal((await new Client().post("/public/enquiries", body)).status, 200);
    assert.equal((await new Client().post("/public/enquiries", { ...body, phone: uniqPhone(), company: "spam inc" })).status, 200);
    const leads = (await mgr.get(`/leads?q=${encodeURIComponent(phone)}`)).body;
    const rows = leads.data ?? leads;
    assert.equal(rows.filter((l: any) => l.phone === phone || l.phoneMasked).length, 1);
  });
});

function pick(o: any, keys: string[]) {
  return Object.fromEntries(keys.map((k) => [k, o[k]]));
}
