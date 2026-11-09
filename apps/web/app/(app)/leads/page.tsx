"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Button, Dialog, ErrorNote, Input, MoneyInput, PageHeader, Select, Skeleton, Textarea, Toast, cx } from "@/components/ui";
import { api, ApiError, fmtDateTime, newKey, PRIVACY_NOTICE_VERSION, relTime, rupees, toPaise } from "@/lib/api";
import { useApi, useSession } from "@/lib/session";

interface Lead {
  id: string; name: string; phone: string; email: string | null; branchId: string; source: string; sourceDetail: string | null;
  interestedPlanId: string | null; interestedPlanName?: string; stage: string; priority: string; assignedToId: string | null; assignedToName: string | null;
  nextFollowUpAt: string | null; lostReason: string | null; convertedMemberId: string | null; createdAt: string; lastActivityAt: string | null;
  activities?: { id: string; type: string; notes: string | null; fromStage: string | null; toStage: string | null; userName: string; occurredAt: string }[];
}
interface Res { total: number; stageCounts: Record<string, number>; data: Lead[] }
interface Plan { id: string; name: string; pricePaise: number }
interface StaffRow { userId: string; displayName: string; branchId: string }

const COLUMNS = [
  ["NEW", "New"], ["CONTACTED", "Contacted"], ["TRIAL_SCHEDULED", "Trial booked"], ["TRIAL_COMPLETED", "Trial done"], ["FOLLOW_UP", "Follow up"],
] as const;
const STAGE_LABEL: Record<string, string> = { ...Object.fromEntries(COLUMNS), CONVERTED: "Joined", LOST: "Lost" };
const SOURCE: Record<string, string> = { WALK_IN: "Walk-in", WEBSITE: "Website", INSTAGRAM: "Instagram", FACEBOOK: "Facebook", GOOGLE_ADS: "Google Ads", WHATSAPP: "WhatsApp", REFERRAL: "Referral", PHONE_CALL: "Phone call", OTHER: "Other" };
const ACT: Record<string, string> = { NOTE: "Note", CALL: "Called", WHATSAPP: "WhatsApp", SMS: "SMS", EMAIL: "Email", VISIT: "Visited", STAGE_CHANGE: "Moved", ASSIGNMENT: "Assigned to" };

function LeadsInner() {
  const { branchId, can } = useSession();
  const params = useSearchParams();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [showClosed, setShowClosed] = useState<"" | "CONVERTED" | "LOST">("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(params.get("new") === "1");
  const [toast, setToast] = useState<string | null>(null);
  const clearToast = useCallback(() => setToast(null), []);
  const dueOnly = params.get("followUpDue") === "true";

  const stages = showClosed || COLUMNS.map((c) => c[0]).join(",");
  const path = `/leads?pageSize=200&stage=${stages}${branchId ? `&branchId=${branchId}` : ""}${q.trim().length >= 2 ? `&q=${encodeURIComponent(q.trim())}` : ""}${dueOnly ? "&followUpDue=true" : ""}`;
  const { data, error, loading, reload } = useApi<Res>(path);

  const byStage = useMemo(() => {
    const m: Record<string, Lead[]> = {};
    for (const l of data?.data ?? []) (m[l.stage] ??= []).push(l);
    return m;
  }, [data]);

  return (
    <>
      <PageHeader
        title="Leads"
        description={dueOnly ? "Showing follow-ups that are due now." : "Everyone who has asked about joining, from first enquiry to signing up."}
        actions={can("leads.create") && <Button onClick={() => setCreating(true)}>Add lead</Button>}
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input type="search" placeholder="Search name or phone" aria-label="Search leads" value={q} onChange={(e) => setQ(e.target.value)}
          className="h-9 w-full max-w-xs rounded-md border border-line bg-surface px-3 placeholder:text-ink-3 focus:border-blue focus:outline-none" />
        <div className="flex gap-1">
          <button onClick={() => { setShowClosed(""); if (dueOnly) router.replace("/leads"); }} aria-pressed={!showClosed && !dueOnly} className={cx("h-8 rounded-md px-3 text-sm font-medium", !showClosed && !dueOnly ? "bg-ink text-chalk" : "text-ink-2 hover:bg-surface-2")}>Open</button>
          <button onClick={() => router.replace("/leads?followUpDue=true")} aria-pressed={dueOnly} className={cx("h-8 rounded-md px-3 text-sm font-medium", dueOnly ? "bg-ink text-chalk" : "text-ink-2 hover:bg-surface-2")}>Due now</button>
          <button onClick={() => setShowClosed("CONVERTED")} aria-pressed={showClosed === "CONVERTED"} className={cx("h-8 rounded-md px-3 text-sm font-medium", showClosed === "CONVERTED" ? "bg-ink text-chalk" : "text-ink-2 hover:bg-surface-2")}>
            Joined {data ? `(${data.stageCounts.CONVERTED})` : ""}
          </button>
          <button onClick={() => setShowClosed("LOST")} aria-pressed={showClosed === "LOST"} className={cx("h-8 rounded-md px-3 text-sm font-medium", showClosed === "LOST" ? "bg-ink text-chalk" : "text-ink-2 hover:bg-surface-2")}>
            Lost {data ? `(${data.stageCounts.LOST})` : ""}
          </button>
        </div>
      </div>
      <ErrorNote error={error} />
      {!data && loading && <Skeleton rows={4} />}
      {data && !showClosed && (
        <div className={cx("grid gap-3 overflow-x-auto pb-2 [grid-template-columns:repeat(5,minmax(200px,1fr))]", loading && "opacity-60")}>
          {COLUMNS.map(([stage, label]) => (
            <section key={stage} className="flex min-h-40 flex-col rounded-lg bg-surface-2/70" aria-label={label}>
              <header className="flex items-baseline justify-between px-3 py-2.5">
                <h2 className="text-lg">{label}</h2>
                <span className="text-sm text-ink-3">{(byStage[stage] ?? []).length}</span>
              </header>
              <ul className="flex flex-col gap-2 px-2 pb-2">
                {(byStage[stage] ?? []).map((l) => <LeadCard key={l.id} lead={l} onOpen={() => setOpenId(l.id)} />)}
              </ul>
            </section>
          ))}
        </div>
      )}
      {data && showClosed && (
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {data.data.map((l) => <LeadCard key={l.id} lead={l} onOpen={() => setOpenId(l.id)} />)}
          {data.data.length === 0 && <li className="text-ink-3">Nothing here yet.</li>}
        </ul>
      )}

      {openId && <LeadDialog id={openId} onClose={() => setOpenId(null)} onChanged={(msg) => { reload(); if (msg) setToast(msg); }} />}
      <NewLeadDialog open={creating} onClose={() => { setCreating(false); if (params.get("new")) router.replace("/leads"); }} onCreated={() => { setCreating(false); setToast("Lead added"); reload(); }} />
      <Toast message={toast} onDone={clearToast} />
    </>
  );
}

function LeadCard({ lead, onOpen }: { lead: Lead; onOpen: () => void }) {
  const overdue = lead.nextFollowUpAt && new Date(lead.nextFollowUpAt).getTime() < Date.now();
  return (
    <li>
      <button onClick={onOpen} className="w-full rounded-md border border-line bg-surface p-3 text-left hover:border-ink-3">
        <span className="flex items-start justify-between gap-2">
          <span className="font-medium">{lead.name}</span>
          {lead.priority === "HIGH" && <span className="mt-1 size-2 shrink-0 rounded-full bg-red" title="High priority" aria-label="High priority" />}
        </span>
        <span className="mt-0.5 block text-xs text-ink-3">{SOURCE[lead.source]}{lead.interestedPlanName ? `, wants ${lead.interestedPlanName}` : ""}</span>
        {lead.stage === "LOST" && lead.lostReason && <span className="mt-2 block text-xs text-ink-2">{lead.lostReason}</span>}
        {lead.nextFollowUpAt && !["CONVERTED", "LOST"].includes(lead.stage) && (
          <span className={cx("mt-2 block text-xs font-medium", overdue ? "text-red" : "text-ink-2")}>Follow up {relTime(lead.nextFollowUpAt)}</span>
        )}
        {lead.assignedToName && <span className="mt-1 block text-xs text-ink-3">{lead.assignedToName}</span>}
      </button>
    </li>
  );
}

function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 16);
}
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);
const tomorrowAt = (h: number) => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(h, 0, 0, 0); return toLocalInput(d.toISOString()); };

function LeadDialog({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: (msg?: string) => void }) {
  const { can } = useSession();
  const router = useRouter();
  const { data: lead, reload } = useApi<Lead>(`/leads/${id}`);
  const [tab, setTab] = useState<"log" | "convert" | "lost">("log");
  const [type, setType] = useState("CALL");
  const [notes, setNotes] = useState("");
  const [nextAt, setNextAt] = useState(tomorrowAt(10));
  const [lostReason, setLostReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function act(fn: () => Promise<unknown>, msg?: string) {
    setBusy(true); setError(null);
    try { await fn(); reload(); onChanged(msg); setNotes(""); } catch (e) { setError(e as ApiError); } finally { setBusy(false); }
  }

  const closed = lead && ["CONVERTED", "LOST"].includes(lead.stage);
  return (
    <Dialog open onClose={onClose} title={lead?.name ?? "Lead"} wide>
      {!lead ? <Skeleton rows={4} /> : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-2">
            <a href={`tel:${lead.phone}`} className="font-medium text-ink hover:underline">{lead.phone}</a>
            <a href={`https://wa.me/${lead.phone.replace("+", "")}`} target="_blank" rel="noopener noreferrer" className="hover:underline">WhatsApp</a>
            <span>{SOURCE[lead.source]}</span>
            {lead.interestedPlanName && <span>Wants {lead.interestedPlanName}</span>}
            <span>Added {fmtDateTime(lead.createdAt)}</span>
          </div>

          {!closed && can("leads.update") && (
            <div className="flex flex-wrap items-end gap-3">
              <Select label="Stage" wrapClass="w-48" value={lead.stage} disabled={busy}
                onChange={(e) => act(() => api(`/leads/${id}/stage`, { body: { stage: e.target.value } }), `Moved to ${STAGE_LABEL[e.target.value]}`)}>
                {COLUMNS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </Select>
              <div className="flex gap-1 pb-0.5">
                {(["log", "convert", "lost"] as const).filter((t) => t !== "convert" || can("leads.convert")).map((t) => (
                  <button key={t} onClick={() => setTab(t)} aria-pressed={tab === t} className={cx("h-9 rounded-md px-3 text-sm font-medium", tab === t ? "bg-ink text-chalk" : "text-ink-2 hover:bg-surface-2")}>
                    {t === "log" ? "Log contact" : t === "convert" ? "Sign up" : "Mark lost"}
                  </button>
                ))}
              </div>
            </div>
          )}

          {!closed && can("leads.update") && tab === "log" && (
            <form className="space-y-3 rounded-lg border border-line p-4" onSubmit={(e) => { e.preventDefault(); void act(() => api(`/leads/${id}/activities`, { body: { type, notes: notes || undefined, nextFollowUpAt: fromLocalInput(nextAt) } }), "Saved"); }}>
              <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
                <Select label="What happened" value={type} onChange={(e) => setType(e.target.value)}>
                  <option value="CALL">Called</option><option value="WHATSAPP">WhatsApp</option><option value="VISIT">Visited the gym</option><option value="SMS">SMS</option><option value="EMAIL">Email</option><option value="NOTE">Note only</option>
                </Select>
                <Input label="Next follow-up" type="datetime-local" value={nextAt} onChange={(e) => setNextAt(e.target.value)} hint="Leave empty for no reminder." />
              </div>
              <Textarea label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What did they say? Timing, budget, goals…" />
              <div className="flex justify-end"><Button type="submit" busy={busy}>Save</Button></div>
            </form>
          )}

          {!closed && tab === "lost" && (
            <form className="space-y-3 rounded-lg border border-line p-4" onSubmit={(e) => { e.preventDefault(); void act(() => api(`/leads/${id}/stage`, { body: { stage: "LOST", lostReason } }), "Marked as lost"); }}>
              <Input label="Why didn't they join?" value={lostReason} onChange={(e) => setLostReason(e.target.value)} required placeholder="Too expensive, moved away, joined another gym…" />
              <div className="flex justify-end"><Button type="submit" variant="danger" busy={busy} disabled={lostReason.trim().length < 2}>Mark as lost</Button></div>
            </form>
          )}

          {!closed && tab === "convert" && <ConvertForm lead={lead} onDone={(memberId) => { onChanged("Signed up"); router.push(`/members/${memberId}`); }} />}

          {lead.stage === "CONVERTED" && lead.convertedMemberId && (
            <Button variant="secondary" onClick={() => router.push(`/members/${lead.convertedMemberId}`)}>Open member profile</Button>
          )}
          <ErrorNote error={error} />

          <section>
            <h3 className="mb-2 text-lg">History</h3>
            <ol className="space-y-3 border-l-2 border-line pl-4">
              {lead.activities?.map((a) => (
                <li key={a.id} className="text-sm">
                  <p>
                    <span className="font-medium">{ACT[a.type]}</span>
                    {a.type === "STAGE_CHANGE" && <> {STAGE_LABEL[a.fromStage ?? ""]} to {STAGE_LABEL[a.toStage ?? ""]}</>}
                    {a.type === "ASSIGNMENT" && <> {a.notes}</>}
                    <span className="text-ink-3"> by {a.userName}, {fmtDateTime(a.occurredAt)}</span>
                  </p>
                  {a.notes && a.type !== "ASSIGNMENT" && <p className="mt-0.5 text-ink-2">{a.notes}</p>}
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}
    </Dialog>
  );
}

function ConvertForm({ lead, onDone }: { lead: Lead; onDone: (memberId: string) => void }) {
  const { can } = useSession();
  const { data: plans } = useApi<Plan[]>("/membership-plans?status=ACTIVE");
  const [planId, setPlanId] = useState(lead.interestedPlanId ?? "");
  const [method, setMethod] = useState("UPI");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [notice, setNotice] = useState(false);
  const [whatsapp, setWhatsapp] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const key = useMemo(() => newKey(), [planId, method, amount, reference, notice, whatsapp]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const r = await api<{ member: { id: string } }>(`/leads/${lead.id}/convert`, {
        idempotencyKey: key,
        body: {
          member: { privacyNoticeVersion: PRIVACY_NOTICE_VERSION, marketingConsents: whatsapp ? ["MARKETING_WHATSAPP"] : [] },
          planId: planId || undefined,
          payment: planId && amount && can("payments.collect") ? { method, amountPaise: toPaise(amount), referenceNumber: reference || undefined } : undefined,
        },
      });
      onDone(r.member.id);
    } catch (err) { setError(err as ApiError); setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-lg border border-line p-4">
      <p className="text-sm text-ink-2">Creates a member profile from this lead. Add more details on the profile afterwards.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label="Membership plan" value={planId} onChange={(e) => setPlanId(e.target.value)}>
          <option value="">Register only, sell later</option>
          {plans?.map((p) => <option key={p.id} value={p.id}>{p.name} — {rupees(p.pricePaise)} + GST</option>)}
        </Select>
        {planId && can("payments.collect") && (
          <Select label="Paid by" value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="UPI">UPI</option><option value="CASH">Cash</option><option value="CARD">Card</option><option value="BANK_TRANSFER">Bank transfer</option>
          </Select>
        )}
        {planId && can("payments.collect") && <MoneyInput label="Amount received" value={amount} onChange={(e) => setAmount(e.target.value)} hint="Leave empty to issue the invoice unpaid. Includes GST and registration fee." />}
        {planId && method !== "CASH" && amount && <Input label="Reference number" value={reference} onChange={(e) => setReference(e.target.value)} required />}
      </div>
      <label className="flex items-start gap-2.5 text-sm"><input type="checkbox" className="mt-0.5 size-4 accent-[var(--ink)]" checked={notice} onChange={(e) => setNotice(e.target.checked)} />They have read privacy notice v{PRIVACY_NOTICE_VERSION}</label>
      <label className="flex items-start gap-2.5 text-sm"><input type="checkbox" className="mt-0.5 size-4 accent-[var(--ink)]" checked={whatsapp} onChange={(e) => setWhatsapp(e.target.checked)} />They're happy to get offers on WhatsApp</label>
      <ErrorNote error={error} />
      {error?.code === "POSSIBLE_DUPLICATE" && <p className="text-sm text-ink-2">Search for them in Members first — they may already be registered.</p>}
      <div className="flex justify-end"><Button type="submit" busy={busy} disabled={!notice}>Sign up {lead.name.split(" ")[0]}</Button></div>
    </form>
  );
}

function NewLeadDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const { branches, branchId } = useSession();
  const { data: plans } = useApi<Plan[]>(open ? "/membership-plans?status=ACTIVE" : null);
  const { data: staff } = useApi<StaffRow[]>(open ? "/staff" : null);
  const [f, setF] = useState({ name: "", phone: "", source: "WALK_IN", interestedPlanId: "", assignedToId: "", priority: "MEDIUM", notes: "", nextFollowUpAt: tomorrowAt(10), branchId: "" });
  const [error, setError] = useState<ApiError | null>(null);
  const [dupe, setDupe] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setF((x) => ({ ...x, branchId: branchId || branches[0]?.id || "" })); setError(null); setDupe(null); } }, [open, branchId, branches]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  async function submit(confirmNotDuplicate = false) {
    setBusy(true); setError(null);
    try {
      await api("/leads", { body: { ...f, interestedPlanId: f.interestedPlanId || null, assignedToId: f.assignedToId || null, notes: f.notes || undefined, nextFollowUpAt: fromLocalInput(f.nextFollowUpAt), confirmNotDuplicate } });
      setF({ ...f, name: "", phone: "", notes: "" });
      onCreated();
    } catch (e) {
      const err = e as ApiError;
      if (err.code === "POSSIBLE_DUPLICATE") setDupe(err.message); else setError(err);
    } finally { setBusy(false); }
  }
  const fe = error?.fieldErrors() ?? {};
  return (
    <Dialog open={open} onClose={onClose} title="Add lead">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Name" required value={f.name} onChange={set("name")} error={fe.name} autoFocus />
          <Input label="Mobile number" type="tel" required value={f.phone} onChange={set("phone")} error={fe.phone} />
          <Select label="How they found us" value={f.source} onChange={set("source")}>
            {Object.entries(SOURCE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
          <Select label="Interested in" value={f.interestedPlanId} onChange={set("interestedPlanId")}>
            <option value="">Not sure yet</option>
            {plans?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          {branches.length > 1 && (
            <Select label="Branch" value={f.branchId} onChange={set("branchId")}>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          )}
          <Select label="Follow-up by" value={f.assignedToId} onChange={set("assignedToId")}>
            <option value="">Nobody yet</option>
            {staff?.filter((s) => !f.branchId || s.branchId === f.branchId).map((s) => <option key={s.userId} value={s.userId}>{s.displayName}</option>)}
          </Select>
          <Input label="First follow-up" type="datetime-local" value={f.nextFollowUpAt} onChange={set("nextFollowUpAt")} />
          <Select label="Priority" value={f.priority} onChange={set("priority")}>
            <option value="LOW">Low</option><option value="MEDIUM">Normal</option><option value="HIGH">High</option>
          </Select>
        </div>
        <Textarea label="Notes" value={f.notes} onChange={set("notes")} />
        <ErrorNote error={error} />
        {dupe && (
          <div role="alert" className="rounded-md border border-yellow/40 bg-tint-yellow p-3 text-sm">
            {dupe}.
            <Button type="button" size="sm" variant="secondary" className="ml-2" onClick={() => submit(true)}>Add anyway</Button>
          </div>
        )}
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" busy={busy} disabled={!f.name || !f.phone}>Add lead</Button>
        </div>
      </form>
    </Dialog>
  );
}

export default function LeadsPage() {
  return <Suspense><LeadsInner /></Suspense>;
}
