"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, ErrorNote } from "@/components/ui";
import { api, ApiError, fmtDate, rupees } from "@/lib/api";

interface Info { brandName: string; amountPaise: number; status: string; expiresAt: string; simulator: boolean; invoiceNumber: string | null; firstName: string; items: string[] }

/** Payment page. With Razorpay connected members pay on Razorpay's own page; this page is the demo stand-in and the "thank you" screen. */
export default function PayPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const [info, setInfo] = useState<Info | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const load = () => api<Info>(`/public/pay/${orderId}`).then(setInfo).catch(setErr);
  useEffect(() => { void load(); }, [orderId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function pay() {
    setBusy(true); setErr(null);
    try { await api(`/public/pay/${orderId}/simulate`, { method: "POST" }); await load(); } catch (e) { setErr(e as ApiError); } finally { setBusy(false); }
  }
  const expired = info && new Date(info.expiresAt) < new Date() && info.status !== "PAID";

  return (
    <main className="grid min-h-screen place-items-center bg-chalk px-5 py-10">
      <div className="w-full max-w-sm rounded-xl border border-line bg-surface p-6 shadow-sm">
        {!info ? (err ? <ErrorNote error={err} /> : <p className="text-center text-ink-3">Loading…</p>) : (
          <div className="flex flex-col gap-4 text-center">
            <p className="font-cond text-xl font-semibold">{info.brandName}</p>
            {info.status === "PAID" ? (
              <>
                <div className="mx-auto grid size-16 place-items-center rounded-full bg-tint-green text-green">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12l5 5 9-10" /></svg>
                </div>
                <p className="text-2xl font-semibold">Payment received</p>
                <p className="text-ink-2">Thank you, {info.firstName}. {rupees(info.amountPaise, true)} has been recorded. A receipt is on its way on WhatsApp.</p>
                <a href="/m" className="font-semibold text-blue hover:underline">Open the member app</a>
              </>
            ) : (
              <>
                <p className="text-ink-2">{info.firstName}, you're paying</p>
                <p className="font-cond text-5xl font-semibold">{rupees(info.amountPaise, true)}</p>
                <ul className="text-sm text-ink-2">{info.items.map((i, k) => <li key={k}>{i}</li>)}</ul>
                {info.invoiceNumber && <p className="text-xs text-ink-3">Invoice {info.invoiceNumber}</p>}
                {expired ? <p className="rounded bg-tint-red px-3 py-2 text-red">This link expired on {fmtDate(info.expiresAt.slice(0, 10))}. Ask the gym for a new one.</p> : info.simulator ? (
                  <>
                    <p className="rounded bg-tint-yellow px-3 py-2 text-sm">Demo payment page — no real money moves. With Razorpay connected, members pay by UPI, card or netbanking here.</p>
                    <Button onClick={pay} busy={busy} className="h-12">Pay {rupees(info.amountPaise, true)} (demo)</Button>
                  </>
                ) : <p className="text-ink-2">Waiting for the payment to be confirmed. If you've paid, this page updates within a minute. <button className="text-blue hover:underline" onClick={load}>Refresh</button></p>}
                <ErrorNote error={err} />
              </>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
