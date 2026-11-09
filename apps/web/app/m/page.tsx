"use client";

import QRCode from "qrcode";
import { useCallback, useEffect, useState } from "react";
import { Button, Dialog, ErrorNote, Input, cx } from "@/components/ui";
import { api, ApiError, fmtDate, fmtDateTime, rupees, setCsrf } from "@/lib/api";
import { useBrand } from "@/lib/brand";

interface Home {
  member: { firstName: string; lastName: string | null; memberCode: string; phone: string; status: string; qrToken: string; branch: { name: string; phone: string | null; addressLine1: string; city: string } };
  membership: { planName: string; status: string; startDate: string; endDate: string; daysLeft: number; totalDays: number } | null;
  upcoming: { planName: string; startDate: string; endDate: string } | null;
  dues: { id: string; invoiceNumber: string; description: string; totalPaise: number; duePaise: number }[];
  onlinePayments: boolean;
  visits: { thisMonth: number; recent: { at: string; out: string | null; branch: string }[] };
  pt: { name: string; trainer: string; left: number; total: number; validUntil: string }[];
  sessions: { at: string; end: string; trainer: string }[];
  workout: { id: string; name: string } | null;
  diet: { id: string; name: string } | null;
}
interface Plan { id: string; name: string; durationDays: number; pricePaise: number; taxRateBp: number; description: string | null }

export default function MemberApp() {
  const brand = useBrand();
  const [state, setState] = useState<"loading" | "login" | "home">("loading");
  const [home, setHome] = useState<Home | null>(null);
  const [err, setErr] = useState<unknown>(null);

  const load = useCallback(async () => {
    try {
      const me = await api<{ kind: string; csrfToken: string }>("/auth/me");
      if (me.kind !== "MEMBER") { window.location.replace("/"); return; }
      setCsrf(me.csrfToken);
      setHome(await api<Home>("/me/home"));
      setState("home");
    } catch (e) {
      if ((e as ApiError).status === 401) setState("login");
      else { setErr(e); setState("login"); }
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="min-h-screen bg-chalk">
      <header className="bg-rail px-5 pb-5 pt-6 text-white">
        <div className="mx-auto flex max-w-md items-center justify-between">
          <p className="font-cond text-2xl font-semibold">{brand?.brandName ?? " "}</p>
          {state === "home" && <button onClick={async () => { await api("/auth/logout", { method: "POST" }).catch(() => undefined); setHome(null); setState("login"); }} className="text-sm text-rail-ink hover:text-white">Sign out</button>}
        </div>
      </header>
      <main className="mx-auto max-w-md px-5 py-6">
        <ErrorNote error={err} />
        {state === "loading" && <p className="py-20 text-center font-cond text-lg text-ink-3">Loading…</p>}
        {state === "login" && <Login onDone={load} />}
        {state === "home" && home && <HomeView h={home} reload={load} />}
      </main>
    </div>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [dev, setDev] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  async function request(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const r = await api<{ devCode?: string }>("/member-auth/otp", { body: { phone } });
      setSent(true); setDev(r.devCode ?? null);
    } catch (e) { setErr(e as ApiError); } finally { setBusy(false); }
  }
  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const r = await api<{ csrfToken: string }>("/member-auth/verify", { body: { phone, code } });
      setCsrf(r.csrfToken);
      onDone();
    } catch (e) { setErr(e as ApiError); setBusy(false); }
  }
  return (
    <div className="pt-6">
      <h1 className="text-3xl">Member sign in</h1>
      <p className="mt-2 text-ink-2">See your membership, show your check-in code and pay online.</p>
      {!sent ? (
        <form onSubmit={request} className="mt-6 flex flex-col gap-4">
          <Input label="Mobile number registered at the gym" inputMode="tel" autoComplete="tel" placeholder="98765 43210" value={phone} onChange={(e) => setPhone(e.target.value)} required autoFocus />
          <ErrorNote error={err} />
          <Button type="submit" busy={busy} className="h-12">Send code on WhatsApp</Button>
        </form>
      ) : (
        <form onSubmit={verify} className="mt-6 flex flex-col gap-4">
          <p className="text-ink-2">We sent a 6-digit code to <b>{phone}</b> on WhatsApp.</p>
          {dev && <p className="rounded bg-tint-yellow px-3 py-2 text-sm">Demo mode: your code is <b className="font-mono">{dev}</b></p>}
          <Input label="Code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} required autoFocus className="text-center font-mono text-2xl tracking-[0.4em]" />
          <ErrorNote error={err} />
          <Button type="submit" busy={busy} className="h-12" disabled={code.length !== 6}>Sign in</Button>
          <button type="button" className="text-sm text-blue hover:underline" onClick={() => { setSent(false); setCode(""); setErr(null); }}>Use a different number or resend</button>
        </form>
      )}
    </div>
  );
}

function HomeView({ h, reload }: { h: Home; reload: () => void }) {
  const [qr, setQr] = useState("");
  const [showQr, setShowQr] = useState(false);
  const [renew, setRenew] = useState(false);
  const [paying, setPaying] = useState<string | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  useEffect(() => { QRCode.toDataURL(h.member.qrToken, { margin: 1, width: 300, errorCorrectionLevel: "M" }).then(setQr); }, [h.member.qrToken]);
  const ms = h.membership;
  const tone = !ms || ms.status === "EXPIRED" ? "red" : ms.daysLeft <= 7 ? "yellow" : "green";

  async function pay(id: string) {
    setPaying(id); setErr(null);
    try { const l = await api<{ url: string }>(`/me/invoices/${id}/pay`, { method: "POST" }); window.location.href = l.url; } catch (e) { setErr(e as ApiError); setPaying(null); }
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-xl">Hi {h.member.firstName} <span className="text-ink-3">· {h.member.memberCode}</span></p>

      <section className={cx("rounded-xl border p-5", tone === "green" ? "border-green/30 bg-tint-green" : tone === "yellow" ? "border-yellow/40 bg-tint-yellow" : "border-red/30 bg-tint-red")}>
        {ms ? (
          <>
            <p className="text-sm font-semibold uppercase tracking-wide text-ink-2">{ms.planName}{ms.status === "FROZEN" && " · on hold"}</p>
            <p className="mt-1 font-cond text-6xl font-semibold leading-none">{ms.status === "EXPIRED" ? "Ended" : ms.status === "SCHEDULED" ? "Starts soon" : <>{ms.daysLeft}<span className="ml-2 text-2xl">days left</span></>}</p>
            <p className="mt-2 text-ink-2">{ms.status === "SCHEDULED" ? `Starts ${fmtDate(ms.startDate)}` : `${ms.status === "EXPIRED" ? "Ended" : "Valid till"} ${fmtDate(ms.endDate)}`}</p>
            {ms.status !== "EXPIRED" && ms.status !== "SCHEDULED" && <div className="mt-3 h-2 rounded-full bg-white/60"><div className="h-full rounded-full bg-ink/70" style={{ width: `${Math.max(3, (ms.daysLeft / ms.totalDays) * 100)}%` }} /></div>}
          </>
        ) : <p className="font-cond text-3xl font-semibold">No membership yet</p>}
        {h.upcoming && <p className="mt-3 text-sm">Next: <b>{h.upcoming.planName}</b> from {fmtDate(h.upcoming.startDate)} to {fmtDate(h.upcoming.endDate)}</p>}
        {h.onlinePayments && !h.upcoming && <Button className="mt-4 h-11 w-full" onClick={() => setRenew(true)}>{ms && ms.status !== "EXPIRED" ? "Renew now" : "Choose a plan"}</Button>}
      </section>

      <button onClick={() => setShowQr(true)} className="flex items-center gap-4 rounded-xl border border-line bg-surface p-4 text-left hover:bg-surface-2">
        {qr && <img src={qr} alt="" width={64} height={64} className="rounded bg-white p-1" />}
        <span><span className="block font-semibold">Check-in code</span><span className="text-sm text-ink-2">Show this at the front desk scanner</span></span>
      </button>

      {h.dues.length > 0 && (
        <section className="rounded-xl border border-line bg-surface p-4">
          <h2 className="text-lg">To pay</h2>
          {h.dues.map((d) => (
            <div key={d.id} className="mt-3 flex items-center justify-between gap-3">
              <span className="min-w-0"><span className="block truncate">{d.description}</span><span className="text-sm text-ink-3">{d.invoiceNumber}</span></span>
              {h.onlinePayments ? <Button onClick={() => pay(d.id)} busy={paying === d.id}>Pay {rupees(d.duePaise)}</Button> : <span className="font-semibold">{rupees(d.duePaise)}</span>}
            </div>
          ))}
          {!h.onlinePayments && <p className="mt-2 text-sm text-ink-3">Please pay at the front desk.</p>}
          <ErrorNote error={err} />
        </section>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-line bg-surface p-4"><p className="text-sm text-ink-2">Visits this month</p><p className="font-cond text-4xl font-semibold">{h.visits.thisMonth}</p></div>
        <div className="rounded-xl border border-line bg-surface p-4"><p className="text-sm text-ink-2">Last visit</p><p className="mt-1 font-semibold">{h.visits.recent[0] ? fmtDateTime(h.visits.recent[0].at) : "—"}</p></div>
      </div>

      {(h.pt.length > 0 || h.sessions.length > 0) && (
        <section className="rounded-xl border border-line bg-surface p-4">
          <h2 className="text-lg">Personal training</h2>
          {h.pt.map((p, i) => <p key={i} className="mt-2"><b>{p.left}</b> of {p.total} sessions left with {p.trainer} <span className="text-sm text-ink-3">· use by {fmtDate(p.validUntil)}</span></p>)}
          {h.sessions.map((s, i) => <p key={i} className="mt-2 text-ink-2">Next: {fmtDateTime(s.at)} with {s.trainer}</p>)}
        </section>
      )}
      {(h.workout || h.diet) && (
        <section className="rounded-xl border border-line bg-surface p-4">
          <h2 className="text-lg">Your plans</h2>
          {h.workout && <p className="mt-2">Workout: <b>{h.workout.name}</b></p>}
          {h.diet && <p className="mt-1">Diet: <b>{h.diet.name}</b></p>}
          <p className="mt-2 text-sm text-ink-3">Ask your trainer for a printed copy.</p>
        </section>
      )}

      <section className="text-sm text-ink-2">
        <p className="font-semibold text-ink">{h.member.branch.name}</p>
        <p>{h.member.branch.addressLine1}, {h.member.branch.city}</p>
        {h.member.branch.phone && <a href={`tel:${h.member.branch.phone}`} className="text-blue">{h.member.branch.phone}</a>}
      </section>

      <Dialog open={showQr} onClose={() => setShowQr(false)} title="Check-in code">
        <div className="flex flex-col items-center gap-3">
          {qr && <img src={qr} alt="Your check-in QR code" width={300} height={300} className="rounded bg-white p-2" />}
          <p className="font-cond text-2xl font-semibold">{h.member.firstName} {h.member.lastName}</p>
          <p className="text-ink-2">{h.member.memberCode}</p>
          <p className="text-sm text-ink-3">Turn your screen brightness up if the scanner doesn't read it.</p>
        </div>
      </Dialog>
      {renew && <Renew onClose={() => setRenew(false)} onError={() => reload()} />}
    </div>
  );
}

function Renew({ onClose }: { onClose: () => void; onError: () => void }) {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  useEffect(() => { api<Plan[]>("/me/plans").then(setPlans).catch(setErr); }, []);
  async function choose(p: Plan) {
    setBusy(p.id); setErr(null);
    try { const l = await api<{ url: string }>("/me/renew", { body: { planId: p.id } }); window.location.href = l.url; } catch (e) { setErr(e as ApiError); setBusy(null); }
  }
  const withTax = (p: Plan) => Math.round((p.pricePaise * (10000 + p.taxRateBp)) / 10000 / 100) * 100;
  return (
    <Dialog open onClose={onClose} title="Choose a plan">
      <div className="flex flex-col gap-3">
        {!plans && !err && <p className="text-ink-3">Loading…</p>}
        {plans?.map((p) => (
          <button key={p.id} onClick={() => choose(p)} disabled={!!busy} className="flex items-center justify-between rounded-lg border border-line p-4 text-left hover:bg-surface-2 disabled:opacity-60">
            <span><span className="block font-semibold">{p.name}</span><span className="text-sm text-ink-3">{p.durationDays} days{p.description ? ` · ${p.description}` : ""}</span></span>
            <span className="text-right"><span className="block font-cond text-2xl font-semibold">{rupees(withTax(p))}</span><span className="text-xs text-ink-3">incl. GST</span></span>
          </button>
        ))}
        <ErrorNote error={err} />
        <p className="text-sm text-ink-3">Your new membership starts the day after the current one ends. A registration fee may apply if this is your first plan.</p>
      </div>
    </Dialog>
  );
}
