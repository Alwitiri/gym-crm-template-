"use client";

import { useEffect, useMemo, useState } from "react";
import { api, ApiError, newKey, rupees, toPaise, fmtDate } from "@/lib/api";
import { useApi, useSession } from "@/lib/session";
import { Button, Dialog, ErrorNote, Input, MoneyInput, Select, cx } from "./ui";

interface Plan { id: string; name: string; durationDays: number; pricePaise: number; registrationFeePaise: number; maxDiscountPaise: number; status: string }
interface Quote {
  startDate: string; endDate: string; subtotalPaise: number; cgstPaise: number; sgstPaise: number; roundOffPaise: number; totalPaise: number;
  items: { itemType: string; description: string; unitPricePaise: number; discountPaise: number; taxableValuePaise: number; taxPaise: number; totalPaise: number }[];
}

const METHODS = [["UPI", "UPI"], ["CASH", "Cash"], ["CARD", "Card"], ["BANK_TRANSFER", "Bank transfer"]] as const;

function PaymentFields({ method, setMethod, amount, setAmount, reference, setReference, due, errors }: {
  method: string; setMethod: (m: string) => void; amount: string; setAmount: (v: string) => void; reference: string; setReference: (v: string) => void; due: number; errors: Record<string, string>;
}) {
  return (
    <fieldset className="space-y-4">
      <legend className="mb-2 text-sm font-medium text-ink-2">Payment method</legend>
      <div className="grid grid-cols-4 gap-1 rounded-md bg-surface-2 p-1" role="radiogroup">
        {METHODS.map(([k, label]) => (
          <button key={k} type="button" role="radio" aria-checked={method === k} onClick={() => setMethod(k)}
            className={cx("h-9 rounded text-sm font-medium", method === k ? "bg-surface text-ink shadow-sm" : "text-ink-2 hover:text-ink")}>{label}</button>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <MoneyInput label="Amount received" value={amount} onChange={(e) => setAmount(e.target.value)} error={errors.amountPaise}
          hint={toPaise(amount) < due && amount ? `${rupees(due - toPaise(amount), true)} will remain due` : undefined} />
        {method !== "CASH" && (
          <Input label={method === "UPI" ? "UPI reference (UTR)" : method === "CARD" ? "Card slip / approval no." : "Bank reference (UTR)"}
            value={reference} onChange={(e) => setReference(e.target.value)} required error={errors.referenceNumber} />
        )}
      </div>
    </fieldset>
  );
}

export function SellMembershipDialog({ open, onClose, memberId, memberName, onDone }: { open: boolean; onClose: () => void; memberId: string; memberName: string; onDone: (msg: string) => void }) {
  const { can } = useSession();
  const { data: plans } = useApi<Plan[]>(open ? "/membership-plans?status=ACTIVE" : null);
  const [planId, setPlanId] = useState("");
  const [discount, setDiscount] = useState("");
  const [waive, setWaive] = useState(false);
  const [takePayment, setTakePayment] = useState(true);
  const [method, setMethod] = useState("UPI");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteErr, setQuoteErr] = useState<ApiError | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  // One key per attempt: a double-click or network retry can't sell twice.
  const key = useMemo(() => newKey(), [open, planId, discount, waive, takePayment, method, amount, reference]);

  useEffect(() => { if (open) { setError(null); setQuote(null); } }, [open]);
  useEffect(() => { if (plans && !planId) setPlanId(plans.find((p) => p.name === "Monthly")?.id ?? plans[0]?.id ?? ""); }, [plans, planId]);

  useEffect(() => {
    if (!open || !planId) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      api<Quote>("/checkout/quote", { body: { memberId, planId, discountPaise: discount ? toPaise(discount) : undefined, waiveRegistrationFee: waive }, signal: ctrl.signal })
        .then((q) => { setQuote(q); setQuoteErr(null); setAmount(String(q.totalPaise / 100)); })
        .catch((e) => { if (e.name !== "AbortError") { setQuote(null); setQuoteErr(e); } });
    }, 200);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [open, memberId, planId, discount, waive]);

  const plan = plans?.find((p) => p.id === planId);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ subscription: { status: string }; invoice: { invoiceNumber: string } }>(`/members/${memberId}/subscriptions`, {
        idempotencyKey: key,
        body: {
          planId, discountPaise: discount ? toPaise(discount) : undefined, waiveRegistrationFee: waive,
          payment: takePayment && can("payments.collect") ? { method, amountPaise: toPaise(amount), referenceNumber: reference || undefined } : undefined,
        },
      });
      onDone(r.subscription.status === "PENDING_PAYMENT" ? `Invoice ${r.invoice.invoiceNumber} issued. Membership starts once it's fully paid.` : `${plan?.name} membership sold. Invoice ${r.invoice.invoiceNumber}.`);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  }

  const fe = error?.fieldErrors() ?? {};
  return (
    <Dialog open={open} onClose={onClose} title={`Sell membership to ${memberName}`} wide>
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
          <Select label="Plan" value={planId} onChange={(e) => setPlanId(e.target.value)}>
            {plans?.map((p) => <option key={p.id} value={p.id}>{p.name} — {rupees(p.pricePaise)} + GST</option>)}
          </Select>
          <MoneyInput label="Discount" placeholder="0" value={discount} onChange={(e) => setDiscount(e.target.value)}
            hint={plan && !can("subscriptions.discount.unlimited") ? `Up to ${rupees(plan.maxDiscountPaise)}` : undefined} />
        </div>
        {quote && quote.items.some((i) => i.itemType === "REGISTRATION_FEE") || waive ? (
          <label className="flex items-center gap-2.5 text-sm">
            <input type="checkbox" className="size-4 accent-[var(--ink)]" checked={waive} onChange={(e) => setWaive(e.target.checked)} />
            Waive the registration fee
          </label>
        ) : null}

        <ErrorNote error={quoteErr} />
        {quote && (
          <div className="rounded-lg border border-line">
            <div className="flex items-baseline justify-between border-b border-line px-4 py-3">
              <span className="text-sm text-ink-2">Valid</span>
              <span className="font-medium">{fmtDate(quote.startDate)} to {fmtDate(quote.endDate)}</span>
            </div>
            <dl className="space-y-1.5 px-4 py-3 text-sm">
              {quote.items.map((i) => (
                <div key={i.itemType} className="flex justify-between">
                  <dt className="text-ink-2">{i.itemType === "MEMBERSHIP" ? `${plan?.name} membership` : "Registration fee"}{i.discountPaise ? ` (less ${rupees(i.discountPaise)})` : ""}</dt>
                  <dd>{rupees(i.taxableValuePaise, true)}</dd>
                </div>
              ))}
              <div className="flex justify-between"><dt className="text-ink-2">CGST 9%</dt><dd>{rupees(quote.cgstPaise, true)}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-2">SGST 9%</dt><dd>{rupees(quote.sgstPaise, true)}</dd></div>
              {quote.roundOffPaise !== 0 && <div className="flex justify-between"><dt className="text-ink-2">Round off</dt><dd>{rupees(quote.roundOffPaise, true)}</dd></div>}
            </dl>
            <div className="flex items-baseline justify-between border-t border-line px-4 py-3">
              <span className="font-medium">Total</span>
              <span className="font-cond text-3xl font-semibold">{rupees(quote.totalPaise)}</span>
            </div>
          </div>
        )}

        {can("payments.collect") && (
          <div className="space-y-4 border-t border-line pt-5">
            <label className="flex items-center gap-2.5 text-sm font-medium">
              <input type="checkbox" className="size-4 accent-[var(--ink)]" checked={takePayment} onChange={(e) => setTakePayment(e.target.checked)} />
              Take payment now
            </label>
            {takePayment && quote && (
              <PaymentFields method={method} setMethod={setMethod} amount={amount} setAmount={setAmount} reference={reference} setReference={setReference} due={quote.totalPaise} errors={fe} />
            )}
          </div>
        )}

        <ErrorNote error={error} />
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} busy={busy} disabled={!quote || (takePayment && can("payments.collect") && (!amount || toPaise(amount) <= 0))}>
            {takePayment && can("payments.collect") ? `Sell and record ${amount ? rupees(toPaise(amount), true) : "payment"}` : "Sell and issue invoice"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

export function CollectPaymentDialog({ open, onClose, memberId, duePaise, onDone }: { open: boolean; onClose: () => void; memberId: string; duePaise: number; onDone: (msg: string) => void }) {
  const [method, setMethod] = useState("UPI");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const key = useMemo(() => newKey(), [open, method, amount, reference]);
  useEffect(() => { if (open) { setAmount(String(duePaise / 100)); setError(null); setReference(""); } }, [open, duePaise]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const p = await api<{ receiptNumber: string; amountPaise: number }>("/payments", { idempotencyKey: key, body: { memberId, method, amountPaise: toPaise(amount), referenceNumber: reference || undefined } });
      onDone(`Recorded ${rupees(p.amountPaise, true)}. Receipt ${p.receiptNumber}.`);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onClose={onClose} title="Collect payment">
      <div className="space-y-5">
        <p className="text-ink-2">Outstanding: <strong className="font-cond text-2xl text-red">{rupees(duePaise, true)}</strong></p>
        <PaymentFields method={method} setMethod={setMethod} amount={amount} setAmount={setAmount} reference={reference} setReference={setReference} due={duePaise} errors={error?.fieldErrors() ?? {}} />
        <p className="text-xs text-ink-3">Applied to the oldest unpaid invoice first.</p>
        <ErrorNote error={error} />
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} busy={busy} disabled={!amount || toPaise(amount) <= 0}>Record {amount ? rupees(toPaise(amount), true) : "payment"}</Button>
        </div>
      </div>
    </Dialog>
  );
}

interface PayLink { orderId: string; url: string; amountPaise: number; expiresAt: string; provider: string; invoiceNumber: string | null; memberFirstName: string; memberPhone: string; brand: string }

/** "Send payment link": creates a Razorpay link for what's due and lets the desk share it or show a QR. */
export function PaymentLinkButton({ invoiceId, size = "sm", variant = "secondary" }: { invoiceId: string; size?: "sm" | "md"; variant?: "secondary" | "ghost" | "primary" }) {
  const status = useApi<{ provider: string | null }>("/payments/online/status");
  const [link, setLink] = useState<PayLink | null>(null);
  const [qr, setQr] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const [copied, setCopied] = useState(false);
  if (!status.data?.provider) return null;

  async function make() {
    setBusy(true); setErr(null);
    try {
      const l = await api<PayLink>(`/invoices/${invoiceId}/payment-link`, { method: "POST" });
      setLink(l);
      const QR = (await import("qrcode")).default;
      setQr(await QR.toDataURL(l.url, { margin: 1, width: 220 }));
    } catch (e) { setErr(e as ApiError); } finally { setBusy(false); }
  }
  const msg = link && `Hi ${link.memberFirstName}, here's your payment link for ${rupees(link.amountPaise, true)} at ${link.brand}${link.invoiceNumber ? ` (invoice ${link.invoiceNumber})` : ""}: ${link.url}`;
  return (
    <>
      <Button size={size} variant={variant} onClick={make} busy={busy}>Payment link</Button>
      {err && !link && <span className="ml-2 text-sm text-red">{err.message}</span>}
      <Dialog open={!!link} onClose={() => setLink(null)} title="Payment link">
        {link && (
          <div className="flex flex-col items-center gap-3 text-center">
            <p className="font-cond text-4xl font-semibold">{rupees(link.amountPaise, true)}</p>
            {qr && <img src={qr} alt="QR code for the payment link" width={220} height={220} className="rounded bg-white p-2" />}
            <p className="text-sm text-ink-2">The member can scan this, or you can send the link. It works with UPI, cards and netbanking until {fmtDate(link.expiresAt.slice(0, 10))}.</p>
            <p className="w-full break-all rounded bg-surface-2 px-3 py-2 font-mono text-sm">{link.url}</p>
            {link.provider === "simulator" && <p className="rounded bg-tint-yellow px-3 py-1.5 text-sm">Demo mode: this is a practice payment page, no real money moves.</p>}
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="secondary" onClick={() => { navigator.clipboard?.writeText(link.url); setCopied(true); }}>{copied ? "Copied" : "Copy link"}</Button>
              <a className="inline-flex h-10 items-center rounded-md bg-[#1f8f4e] px-4 font-medium text-white hover:bg-[#187a42]" target="_blank" rel="noopener noreferrer"
                href={`https://wa.me/${link.memberPhone.replace(/\D/g, "")}?text=${encodeURIComponent(msg!)}`}>Send on WhatsApp</a>
            </div>
            <p className="text-xs text-ink-3">When it's paid, the payment is recorded and the membership starts by itself.</p>
          </div>
        )}
      </Dialog>
    </>
  );
}
