"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, Dialog, Empty, ErrorNote, PageHeader, Pager, Panel, Skeleton, Tabs, Textarea, Toast, Toggle, cx } from "@/components/ui";
import { api, ApiError, fmtDateTime } from "@/lib/api";
import { useApi, useSession } from "@/lib/session";

interface Msg { id: string; kind: string | null; kindLabel: string; status: string; text: string; destination: string; memberId: string | null; memberName: string | null; memberCode: string | null; whatsappUrl: string; scheduledFor: string; sentAt: string | null; errorMessage: string | null }
interface Res { mode: "manual" | "whatsapp_cloud"; page: number; pageSize: number; total: number; counts: Record<string, number>; data: Msg[] }
interface Tpl { id: string; key: string; label: string; body: string; enabled: boolean; isMarketing: boolean; providerTemplateName: string | null; variables: string[] }
type Tab = "QUEUED" | "SENT" | "FAILED" | "SKIPPED_NO_CONSENT" | "templates";

const KIND_TONE: Record<string, string> = { "expiry.before": "bg-tint-yellow", "expiry.today": "bg-tint-red", "expiry.after": "bg-tint-red", "dues.reminder": "bg-tint-yellow", welcome: "bg-tint-green", "payment.receipt": "bg-tint-green", "pt.tomorrow": "bg-tint-blue", birthday: "bg-tint-blue" };

export default function MessagesPage() {
  const { can } = useSession();
  const [tab, setTab] = useState<Tab>("QUEUED");
  const [page, setPage] = useState(1);
  const list = useApi<Res>(tab === "templates" ? null : `/notifications?status=${tab}&page=${page}`);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const d = list.data;
  const c = d?.counts ?? {};

  async function run() {
    setBusy(true);
    try {
      const r = await api<{ queued: number; sent: number; failed: number }>("/notifications/run", { method: "POST" });
      setToast(r.queued || r.sent ? `${r.queued} new reminders${r.sent ? `, ${r.sent} sent` : ""}` : "Everything's up to date — no new reminders");
      list.reload();
    } catch (e) { setToast((e as Error).message); } finally { setBusy(false); }
  }
  async function act(m: Msg, what: "sent" | "skip") {
    try { await api(`/notifications/${m.id}/${what}`, { method: "POST" }); list.reload(); } catch (e) { setToast((e as Error).message); }
  }
  function openWa(m: Msg) {
    window.open(m.whatsappUrl, "_blank", "noopener");
    setOpened((s) => new Set(s).add(m.id));
  }

  return (
    <>
      <PageHeader title="Messages" description="Reminders, receipts and welcome messages for members on WhatsApp."
        actions={can("notifications.manage") && <Button variant="secondary" onClick={run} busy={busy}>Check for new reminders</Button>} />
      {d && (d.mode === "manual" ? (
        <div className="mb-5 rounded-lg border border-line bg-surface px-4 py-3">
          <p className="font-semibold">Send from your phone or WhatsApp Web</p>
          <p className="text-sm text-ink-2">Press <b>Open in WhatsApp</b>: the message is typed for you, just hit send. Then mark it sent. To send everything automatically, connect the WhatsApp Business API (see the operations guide).</p>
        </div>
      ) : (
        <div className="mb-5 rounded-lg border border-green/30 bg-tint-green px-4 py-3 text-sm"><b>Automatic sending is on.</b> Messages go out by themselves through the WhatsApp Business API between your set time and 9 pm.</div>
      ))}
      <Tabs value={tab} onChange={(t) => { setTab(t); setPage(1); }} items={[
        ["QUEUED", `To send${c.QUEUED ? ` (${c.QUEUED})` : ""}`], ["SENT", "Sent"], ["FAILED", `Failed / skipped${c.FAILED ? ` (${c.FAILED})` : ""}`], ["SKIPPED_NO_CONSENT", "No consent"], ["templates", "Wording"],
      ]} />
      {tab === "templates" ? <Templates onToast={setToast} /> : (
        <Panel padded={false}>
          <ErrorNote error={list.error} />
          {!d && list.loading ? <Skeleton /> : d && d.data.length === 0 ? (
            <Empty title={tab === "QUEUED" ? "Nothing to send right now" : "Nothing here"}>{tab === "QUEUED" ? "New reminders appear here every morning." : tab === "SKIPPED_NO_CONSENT" ? "Marketing messages (like birthday wishes) are only sent to members who agreed to them." : null}</Empty>
          ) : d && (
            <ul className="divide-y divide-line">
              {d.data.map((m) => (
                <li key={m.id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cx("rounded px-2 py-0.5 text-xs font-semibold", KIND_TONE[m.kind ?? ""] ?? "bg-surface-2")}>{m.kindLabel}</span>
                      {m.memberId ? <Link href={`/members/${m.memberId}`} className="font-medium hover:underline">{m.memberName}</Link> : <span className="font-medium">{m.destination}</span>}
                      <span className="text-sm text-ink-3">{m.destination}</span>
                    </div>
                    <p className="mt-1.5 whitespace-pre-wrap text-ink-2">{m.text}</p>
                    <p className="mt-1 text-xs text-ink-3">{m.sentAt ? `Sent ${fmtDateTime(m.sentAt)}` : `Queued ${fmtDateTime(m.scheduledFor)}`}{m.errorMessage && ` · ${m.errorMessage}`}</p>
                  </div>
                  {tab === "QUEUED" && can("notifications.send") && (
                    <div className="flex shrink-0 gap-2">
                      {d.mode === "manual" && <button onClick={() => openWa(m)} className="inline-flex h-8 items-center rounded-md bg-[#1f8f4e] px-3 text-sm font-medium text-white hover:bg-[#187a42]">Open in WhatsApp</button>}
                      <Button size="sm" variant={opened.has(m.id) ? "primary" : "secondary"} onClick={() => act(m, "sent")}>Mark sent</Button>
                      <Button size="sm" variant="ghost" onClick={() => act(m, "skip")}>Skip</Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {d && <Pager page={d.page} pageSize={d.pageSize} total={d.total} onPage={setPage} />}
        </Panel>
      )}
      <Toast message={toast} onDone={() => setToast(null)} />
    </>
  );
}

const SAMPLE: Record<string, string> = { gym: "Your Gym", firstName: "Priya", memberCode: "CBE-RSP-000123", planName: "Quarterly", endDate: "30 Nov 2026", days: "3", amount: "₹1,500", invoiceNumber: "INV/2026-27/0042", payLine: "Pay online: https://rzp.io/i/abc", trainer: "Vikram", time: "7:00 am", receiptNumber: "RC-RSP-000321" };

function Templates({ onToast }: { onToast: (m: string) => void }) {
  const { can } = useSession();
  const { data, error, reload } = useApi<Tpl[]>("/notification-templates");
  const [edit, setEdit] = useState<Tpl | null>(null);
  async function toggle(t: Tpl, enabled: boolean) {
    try { await api(`/notification-templates/${t.id}`, { method: "PATCH", body: { enabled } }); reload(); } catch (e) { onToast((e as Error).message); }
  }
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Skeleton />;
  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        {data.map((t) => (
          <Panel key={t.id} title={t.label} actions={can("notifications.manage") && <Button size="sm" variant="ghost" onClick={() => setEdit(t)}>Edit</Button>}>
            <p className="whitespace-pre-wrap text-ink-2">{t.body.replace(/\{\{(\w+)\}\}/g, (_, k) => SAMPLE[k] ?? `{{${k}}}`)}</p>
            <div className="mt-2 border-t border-line pt-1">
              {can("notifications.manage") ? <Toggle label={t.enabled ? "On" : "Off"} hint={t.isMarketing ? "Marketing: only members who agreed get this" : undefined} checked={t.enabled} onChange={(v) => toggle(t, v)} /> : <p className="text-sm text-ink-3">{t.enabled ? "On" : "Off"}</p>}
            </div>
          </Panel>
        ))}
      </div>
      <p className="mt-4 text-sm text-ink-3">With the WhatsApp Business API, each message needs a template approved by Meta with the same wording; the template name is shown when editing.</p>
      {edit && <EditTemplate t={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); onToast("Wording saved"); reload(); }} />}
    </>
  );
}

function EditTemplate({ t, onClose, onSaved }: { t: Tpl; onClose: () => void; onSaved: () => void }) {
  const [body, setBody] = useState(t.body);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const vars = [...new Set([...t.variables, "gym"])];
  async function save() {
    setBusy(true); setErr(null);
    try { await api(`/notification-templates/${t.id}`, { method: "PATCH", body: { body } }); onSaved(); } catch (e) { setErr(e as ApiError); } finally { setBusy(false); }
  }
  return (
    <Dialog open onClose={onClose} title={`Edit: ${t.label}`} wide>
      <Textarea label="Message" rows={5} value={body} onChange={(e) => setBody(e.target.value)} maxLength={1000} />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {vars.map((v) => <button key={v} type="button" onClick={() => setBody((b) => b + `{{${v}}}`)} className="rounded border border-line px-2 py-0.5 font-mono text-xs hover:bg-surface-2">{`{{${v}}}`}</button>)}
      </div>
      <p className="mt-4 text-sm font-medium text-ink-2">Preview</p>
      <p className="mt-1 whitespace-pre-wrap rounded-lg bg-tint-green px-3 py-2">{body.replace(/\{\{(\w+)\}\}/g, (_, k) => SAMPLE[k] ?? `{{${k}}}`)}</p>
      {t.providerTemplateName && <p className="mt-3 text-xs text-ink-3">WhatsApp template name: <span className="font-mono">{t.providerTemplateName}</span></p>}
      <ErrorNote error={err} />
      <div className="mt-5 flex justify-end gap-2"><Button variant="secondary" onClick={() => setBody(t.body)}>Undo changes</Button><Button onClick={save} busy={busy}>Save</Button></div>
    </Dialog>
  );
}
