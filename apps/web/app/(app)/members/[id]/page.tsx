"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { PaymentLinkButton, CollectPaymentDialog, SellMembershipDialog } from "@/components/billing-dialogs";
import { DietSection, FreezeDialog, FreezeInfo, MetricsSection, PtSection, TrainerPanel, VisitsSection, WorkoutSection } from "@/components/training";
import { api } from "@/lib/api";
import { Button, Empty, ErrorNote, Panel, Skeleton, Status, Table, Td, Th, Toast, cx } from "@/components/ui";
import { daysUntil, fmtDate, fmtDateTime, rupees } from "@/lib/api";
import { useApi, useSession } from "@/lib/session";

interface Sub {
  id: string; planName: string; status: string; startDate: string; endDate: string; daysRemaining: number; invoiceId: string | null;
  freeze?: FreezeInfo; freezes?: { id: string; startDate: string; endDate: string; endedEarlyOn: string | null; reason: string | null }[];
}
interface Member {
  id: string; memberCode: string; fullName: string; firstName: string; phone: string; email: string | null; dateOfBirth: string | null; age: number | null;
  gender: string | null; addressLine1: string | null; city: string | null; pincode: string | null;
  emergencyContact: { name: string | null; phone: string | null; relation: string | null };
  homeBranch: { id: string; name: string }; status: string; joinedOn: string; qrToken?: string;
  currentSubscription: Sub | null; subscriptions: Sub[]; currentTrainer: { id: string; displayName: string } | null;
  consents: Record<string, { granted: boolean; recordedAt: string }>;
  duesPaise?: number; creditPaise?: number;
  invoices?: { id: string; invoiceNumber: string; status: string; issueDate: string; totalPaise: number; paidPaise: number; duePaise: number }[];
  payments?: { id: string; receiptNumber: string; method: string; amountPaise: number; referenceNumber: string | null; receivedAt: string }[];
}

const METHOD: Record<string, string> = { CASH: "Cash", UPI: "UPI", CARD: "Card", BANK_TRANSFER: "Bank transfer", GATEWAY: "Online" };

function MemberInner() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const { can } = useSession();
  const { data: m, error, loading, reload } = useApi<Member>(`/members/${id}`);
  const [sellOpen, setSellOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [freezeOpen, setFreezeOpen] = useState(false);
  const [tab, setTab] = useState<"overview" | "visits" | "training" | "pt">("overview");
  const [toast, setToast] = useState<string | null>(null);
  const clearToast = useCallback(() => setToast(null), []);

  useEffect(() => {
    if (params.get("sell") === "1" && m && can("subscriptions.sell")) {
      setSellOpen(true);
      router.replace(`/members/${id}`);
    }
  }, [params, m, can, router, id]);

  if (error) return <ErrorNote error={error} />;
  if (!m) return <Panel>{loading ? <Skeleton rows={6} /> : null}</Panel>;

  const cur = m.currentSubscription;
  const next = m.subscriptions.find((s) => s.status === "SCHEDULED");
  const pending = m.subscriptions.find((s) => s.status === "PENDING_PAYMENT");
  const lastEnded = !cur ? m.subscriptions.find((s) => s.status === "EXPIRED") : null;
  const done = (msg: string) => { setSellOpen(false); setPayOpen(false); setFreezeOpen(false); setToast(msg); reload(); };
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  const openFreeze = cur?.freezes?.find((f) => !f.endedEarlyOn && f.endDate >= today);
  const canTrain = can("workouts.manage") || can("workouts.manage.any");
  const tabs = [
    ["overview", "Overview", true],
    ["visits", "Visits", can("attendance.read") || can("attendance.read.assigned") || can("members.read")],
    ["training", "Training", can("workouts.read") || can("workouts.read.assigned")],
    ["pt", "Personal training", can("pt.read") || can("pt.read.assigned")],
  ] as const;
  async function unfreeze() {
    try {
      const s = await api<{ endDate: string }>(`/subscriptions/${cur!.id}/unfreeze`, { method: "POST" });
      done(`Freeze ended. Membership now ends ${fmtDate(s.endDate)}.`);
    } catch (e) { setToast((e as Error).message); }
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start gap-x-8 gap-y-4">
        <div className="min-w-0 flex-1 basis-80">
          <p className="text-sm text-ink-3"><Link href="/members" className="hover:underline">Members</Link></p>
          <h1 className="mt-1 text-4xl">{m.fullName}</h1>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-ink-2">
            <Status value={m.status} />
            <span>{m.memberCode}</span>
            <a href={`tel:${m.phone}`} className="hover:underline">{m.phone}</a>
            <span>{m.homeBranch.name}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {can("subscriptions.sell") && <Button onClick={() => setSellOpen(true)}>{cur || next ? "Renew membership" : "Sell membership"}</Button>}
          {can("payments.collect") && (m.duesPaise ?? 0) > 0 && <Button variant="secondary" onClick={() => setPayOpen(true)}>Collect {rupees(m.duesPaise!)}</Button>}
          {cur && cur.freeze?.allowed && can("subscriptions.freeze") && !openFreeze && cur.freeze.timesLeft > 0 && cur.freeze.daysLeft > 0 && (
            <Button variant="secondary" onClick={() => setFreezeOpen(true)}>Freeze</Button>
          )}
          {openFreeze && can("subscriptions.freeze") && (
            <Button variant="secondary" onClick={unfreeze}>{openFreeze.startDate > today ? "Cancel planned freeze" : "Unfreeze now"}</Button>
          )}
          {m.qrToken && <Link href={`/print/card/${m.id}`} target="_blank" className="inline-flex h-10 items-center rounded-md border border-line bg-surface px-4 font-medium hover:bg-surface-2">Membership card</Link>}
          {can("members.read") && (
            <a className="inline-flex h-10 items-center rounded-md px-3 text-ink-2 hover:bg-surface-2" href={`https://wa.me/${m.phone.replace("+", "")}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>
          )}
        </div>
      </div>

      {/* The one loud element: how long this membership has left. */}
      <section className="mb-6 grid overflow-hidden rounded-lg border border-line bg-surface md:grid-cols-[280px_1fr]" aria-label="Current membership">
        <MembershipClock cur={cur} pending={pending} lastEnded={lastEnded} />
        <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-4">
          <Fact label="Plan" value={cur?.planName ?? pending?.planName ?? "—"} />
          <Fact label="Valid" value={cur ? `${fmtDate(cur.startDate, true)} to ${fmtDate(cur.endDate)}` : "—"} />
          <Fact label="Next membership" value={next ? `${next.planName} from ${fmtDate(next.startDate, true)}` : "Not renewed yet"} tone={!next && cur && cur.daysRemaining <= 7 ? "text-yellow" : undefined} />
          {m.duesPaise !== undefined ? (
            <Fact label="Dues" value={m.duesPaise ? rupees(m.duesPaise, true) : "Nothing due"} tone={m.duesPaise ? "text-red" : "text-green"} />
          ) : <Fact label="Trainer" value={m.currentTrainer?.displayName ?? "—"} />}
        </div>
      </section>

      {openFreeze && (
        <p className="mb-6 rounded-md border border-blue/30 bg-tint-blue px-4 py-3 text-sm text-blue">
          {openFreeze.startDate > today ? "Freeze planned" : "Frozen"} from {fmtDate(openFreeze.startDate)} to {fmtDate(openFreeze.endDate)}{openFreeze.reason ? ` (${openFreeze.reason})` : ""}. Check-in is blocked during the freeze.
        </p>
      )}

      <div className="mb-6 flex gap-1 border-b border-line" role="tablist">
        {tabs.filter(([, , show]) => show).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={cx("-mb-px border-b-2 px-4 py-2.5 font-medium", tab === k ? "border-ink text-ink" : "border-transparent text-ink-2 hover:text-ink")}>{label}</button>
        ))}
      </div>

      {tab === "visits" && <VisitsSection memberId={m.id} />}
      {tab === "training" && (
        <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
          <div className="space-y-6">
            <WorkoutSection memberId={m.id} canWrite={canTrain} />
            <DietSection memberId={m.id} canWrite={canTrain} />
          </div>
          <div className="space-y-6">
            <TrainerPanel memberId={m.id} current={m.currentTrainer} onChanged={(msg) => { setToast(msg); reload(); }} />
            <MetricsSection memberId={m.id} canWrite={canTrain} />
          </div>
        </div>
      )}
      {tab === "pt" && <PtSection memberId={m.id} memberName={m.firstName} onToast={setToast} />}

      {tab === "overview" && <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Panel title="Membership history" padded={false}>
            {m.subscriptions.length === 0 ? <Empty title="No memberships yet">{can("subscriptions.sell") && "Sell the first membership to activate check-in."}</Empty> : (
              <Table>
                <thead><tr><Th>Plan</Th><Th>From</Th><Th>To</Th><Th>Status</Th><Th /></tr></thead>
                <tbody>
                  {m.subscriptions.map((s) => (
                    <tr key={s.id}>
                      <Td className="font-medium">{s.planName}</Td>
                      <Td>{fmtDate(s.startDate)}</Td>
                      <Td>{fmtDate(s.endDate)}</Td>
                      <Td><Status value={s.status} /></Td>
                      <Td className="text-right">{s.invoiceId && can("invoices.read") && <Link className="text-sm text-blue hover:underline" href={`/invoices/${s.invoiceId}`}>Invoice</Link>}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Panel>

          {m.invoices && (
            <Panel title="Invoices and payments" padded={false} actions={m.creditPaise ? <span className="text-sm text-green">Credit {rupees(m.creditPaise, true)}</span> : null}>
              {m.invoices.length === 0 ? <Empty title="No invoices yet" /> : (
                <Table>
                  <thead><tr><Th>Invoice</Th><Th>Date</Th><Th className="text-right">Total</Th><Th className="text-right">Paid</Th><Th>Status</Th><Th /></tr></thead>
                  <tbody>
                    {m.invoices.map((i) => (
                      <tr key={i.id}>
                        <Td><Link href={`/invoices/${i.id}`} className="font-medium text-blue hover:underline">{i.invoiceNumber}</Link></Td>
                        <Td>{fmtDate(i.issueDate)}</Td>
                        <Td className="text-right">{rupees(i.totalPaise, true)}</Td>
                        <Td className="text-right">{rupees(i.paidPaise, true)}</Td>
                        <Td><Status value={i.status} /></Td>
                        <Td className="text-right">{i.duePaise > 0 && ["ISSUED", "PARTIALLY_PAID"].includes(i.status) && can("payments.collect") && <PaymentLinkButton invoiceId={i.id} variant="ghost" />}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
              {m.payments && m.payments.length > 0 && (
                <ul className="border-t border-line">
                  {m.payments.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 border-b border-line px-4 py-2.5 text-sm last:border-0">
                      <span>
                        <span className="font-medium">{rupees(p.amountPaise, true)}</span> by {METHOD[p.method] ?? p.method}
                        {p.referenceNumber && <span className="text-ink-3"> ({p.referenceNumber})</span>}
                      </span>
                      <span className="text-ink-3">{p.receiptNumber}, {fmtDateTime(p.receivedAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}
        </div>

        <div className="space-y-6">
          <Panel title="Details">
            <dl className="space-y-3 text-sm">
              <Detail k="Email" v={m.email} />
              <Detail k="Age" v={m.age != null ? `${m.age} (born ${fmtDate(m.dateOfBirth)})` : null} />
              <Detail k="Address" v={[m.addressLine1, m.city, m.pincode].filter(Boolean).join(", ") || null} />
              <Detail k="Emergency contact" v={m.emergencyContact.name ? `${m.emergencyContact.name}${m.emergencyContact.relation ? ` (${m.emergencyContact.relation})` : ""}, ${m.emergencyContact.phone ?? ""}` : null} />
              <Detail k="Trainer" v={m.currentTrainer?.displayName ?? null} />
              <Detail k="Member since" v={fmtDate(m.joinedOn)} />
            </dl>
          </Panel>
          <Panel title="Messages the member agreed to">
            <ul className="space-y-1.5 text-sm">
              {([["MARKETING_WHATSAPP", "Offers on WhatsApp"], ["MARKETING_SMS", "Offers by SMS"], ["MARKETING_EMAIL", "Offers by email"]] as const).map(([k, label]) => (
                <li key={k} className="flex justify-between"><span>{label}</span><span className={m.consents[k]?.granted ? "text-green" : "text-ink-3"}>{m.consents[k]?.granted ? "Yes" : "No"}</span></li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-ink-3">Privacy notice acknowledged {m.consents.PRIVACY_NOTICE ? fmtDateTime(m.consents.PRIVACY_NOTICE.recordedAt) : "— not recorded"}.</p>
          </Panel>
        </div>
      </div>}

      <SellMembershipDialog open={sellOpen} onClose={() => setSellOpen(false)} memberId={m.id} memberName={m.firstName} onDone={done} />
      {freezeOpen && cur?.freeze && <FreezeDialog subscriptionId={cur.id} endDate={cur.endDate} freeze={cur.freeze} onClose={() => setFreezeOpen(false)} onDone={done} />}
      <CollectPaymentDialog open={payOpen} onClose={() => setPayOpen(false)} memberId={m.id} duePaise={m.duesPaise ?? 0} onDone={done} />
      <Toast message={toast} onDone={clearToast} />
    </>
  );
}

function MembershipClock({ cur, pending, lastEnded }: { cur: Sub | null; pending?: Sub; lastEnded: Sub | null | undefined }) {
  let big = "—", unit = "", note = "No membership", tone = "text-ink-3", bar = "bg-ink-3";
  if (cur) {
    const d = cur.daysRemaining;
    big = String(d); unit = d === 1 ? "day left" : "days left";
    note = `Ends ${fmtDate(cur.endDate)}`;
    tone = d <= 3 ? "text-red" : d <= 7 ? "text-yellow" : "text-green";
    bar = d <= 3 ? "bg-red" : d <= 7 ? "bg-yellow" : "bg-green";
    if (cur.status === "FROZEN") { tone = "text-blue"; bar = "bg-blue"; note = "Frozen"; }
  } else if (pending) {
    big = "Unpaid"; note = `${pending.planName} starts once the invoice is paid`; tone = "text-yellow"; bar = "bg-yellow";
  } else if (lastEnded) {
    const ago = -daysUntil(lastEnded.endDate);
    big = String(ago); unit = ago === 1 ? "day since expiry" : "days since expiry"; note = `Expired ${fmtDate(lastEnded.endDate)}`; tone = "text-red"; bar = "bg-red";
  }
  return (
    <div className="relative flex flex-col justify-center px-6 py-6">
      <span className={cx("absolute inset-y-0 left-0 w-1.5", bar)} aria-hidden />
      <p className={cx("font-cond font-bold leading-[0.85]", big.length > 4 ? "text-5xl" : "text-[5.5rem]", tone)}>{big}</p>
      {unit && <p className="mt-1 font-cond text-xl font-medium text-ink-2">{unit}</p>}
      <p className="mt-2 text-sm text-ink-3">{note}</p>
    </div>
  );
}

function Fact({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="bg-surface px-4 py-4">
      <p className="text-sm text-ink-3">{label}</p>
      <p className={cx("mt-1 font-medium", tone)}>{value}</p>
    </div>
  );
}

function Detail({ k, v }: { k: string; v: string | null }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-2">
      <dt className="text-ink-3">{k}</dt>
      <dd className={v ? "" : "text-ink-3"}>{v || "—"}</dd>
    </div>
  );
}

export default function MemberPage() {
  return <Suspense><MemberInner /></Suspense>;
}
