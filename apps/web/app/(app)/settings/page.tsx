"use client";

import { useEffect, useState } from "react";
import { Button, ErrorNote, Input, PageHeader, Panel, Select, Skeleton, Tabs, Textarea, Toast, Toggle } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { forgetBrand } from "@/lib/brand";
import { useApi, useSession } from "@/lib/session";

interface Business { brandName: string; legalName: string; gstin: string | null; pan: string | null; stateCode: string }
type Rules = Record<string, any>;

const STATES: [string, string][] = [
  ["01", "Jammu & Kashmir"], ["02", "Himachal Pradesh"], ["03", "Punjab"], ["04", "Chandigarh"], ["05", "Uttarakhand"], ["06", "Haryana"], ["07", "Delhi"], ["08", "Rajasthan"],
  ["09", "Uttar Pradesh"], ["10", "Bihar"], ["18", "Assam"], ["19", "West Bengal"], ["20", "Jharkhand"], ["21", "Odisha"], ["22", "Chhattisgarh"], ["23", "Madhya Pradesh"],
  ["24", "Gujarat"], ["27", "Maharashtra"], ["29", "Karnataka"], ["30", "Goa"], ["32", "Kerala"], ["33", "Tamil Nadu"], ["34", "Puducherry"], ["36", "Telangana"], ["37", "Andhra Pradesh"],
];
const list = (v: string) => [...new Set(v.split(/[\s,]+/).filter(Boolean).map(Number).filter((n) => Number.isInteger(n) && n >= 0))].sort((a, b) => b - a);

export default function SettingsPage() {
  const { can, me } = useSession();
  const { data, error, reload } = useApi<{ business: Business; rules: Rules }>("/settings");
  const [tab, setTab] = useState<"business" | "rules" | "reminders">("business");
  const [biz, setBiz] = useState<Business | null>(null);
  const [rules, setRules] = useState<Rules | null>(null);
  const [before, setBefore] = useState("");
  const [after, setAfter] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const editable = can("settings.manage") && me.branchIds === "*";

  useEffect(() => {
    if (!data) return;
    setBiz(data.business);
    setRules(data.rules);
    setBefore(data.rules["reminders.expiryDaysBefore"].join(", "));
    setAfter(data.rules["reminders.expiryDaysAfter"].join(", "));
  }, [data]);

  async function save() {
    if (!biz || !rules) return;
    setBusy(true); setErr(null);
    try {
      await api("/settings", {
        method: "PATCH",
        body: {
          business: { brandName: biz.brandName, legalName: biz.legalName, gstin: biz.gstin ?? "", pan: biz.pan ?? "", stateCode: biz.stateCode },
          rules: { ...rules, "reminders.expiryDaysBefore": list(before).slice(0, 5), "reminders.expiryDaysAfter": list(after).filter((n) => n > 0).slice(0, 5) },
        },
      });
      forgetBrand();
      setToast("Settings saved");
      reload();
    } catch (e) { setErr(e as ApiError); } finally { setBusy(false); }
  }
  const fe = err?.fieldErrors() ?? {};
  const r = (k: string) => rules?.[k];
  const setR = (k: string, v: unknown) => setRules((x) => ({ ...x!, [k]: v }));

  return (
    <>
      <PageHeader title="Settings" description="Your gym's name, tax details and the rules the software follows."
        actions={editable && <Button onClick={save} busy={busy}>Save changes</Button>} />
      <ErrorNote error={error} />
      {!editable && data && <p className="mb-4 rounded-md bg-tint-yellow px-3 py-2 text-sm">Only the owner can change these settings. You can view them.</p>}
      <Tabs value={tab} onChange={setTab} items={[["business", "Business & invoices"], ["rules", "Check-in & privacy"], ["reminders", "Reminders"]]} />
      {!biz || !rules ? <Skeleton /> : (
        <fieldset disabled={!editable} className="max-w-3xl space-y-5">
          {tab === "business" && (
            <>
              <Panel title="Business">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input label="Gym name (shown everywhere)" value={biz.brandName} onChange={(e) => setBiz({ ...biz, brandName: e.target.value })} error={fe["business.brandName"]} />
                  <Input label="Registered business name (on invoices)" value={biz.legalName} onChange={(e) => setBiz({ ...biz, legalName: e.target.value })} error={fe["business.legalName"]} />
                  <Input label="GSTIN" hint="Leave empty if you're not GST-registered" value={biz.gstin ?? ""} onChange={(e) => setBiz({ ...biz, gstin: e.target.value.toUpperCase() })} error={fe["business.gstin"]} maxLength={15} />
                  <Input label="PAN" value={biz.pan ?? ""} onChange={(e) => setBiz({ ...biz, pan: e.target.value.toUpperCase() })} error={fe["business.pan"]} maxLength={10} />
                  <Select label="State (for GST)" value={biz.stateCode} onChange={(e) => setBiz({ ...biz, stateCode: e.target.value })}>
                    {STATES.map(([c, n]) => <option key={c} value={c}>{c} · {n}</option>)}
                  </Select>
                </div>
              </Panel>
              <Panel title="Contact details for members">
                <div className="grid gap-4 sm:grid-cols-3">
                  <Input label="Phone" value={r("business.phone")} onChange={(e) => setR("business.phone", e.target.value)} />
                  <Input label="Email" type="email" value={r("business.email")} onChange={(e) => setR("business.email", e.target.value)} />
                  <Input label="Website" value={r("business.website")} onChange={(e) => setR("business.website", e.target.value)} />
                </div>
              </Panel>
              <Panel title="Invoice text">
                <div className="grid gap-4">
                  <Textarea label="Footer" value={r("invoice.footer")} onChange={(e) => setR("invoice.footer", e.target.value)} maxLength={500} />
                  <Textarea label="Terms" value={r("invoice.terms")} onChange={(e) => setR("invoice.terms", e.target.value)} maxLength={1000} />
                </div>
              </Panel>
            </>
          )}
          {tab === "rules" && (
            <>
              <Panel title="Check-in">
                <Input type="number" min={0} max={15} label="Grace days after a membership ends" wrapClass="max-w-xs"
                  hint="Members can still check in for this many days after expiry (they're flagged at the desk). 0 = none."
                  value={r("checkin.graceDays")} onChange={(e) => setR("checkin.graceDays", Math.max(0, Math.min(15, Number(e.target.value) || 0)))} />
              </Panel>
              <Panel title="Privacy notice">
                <Input label="Current privacy notice version" wrapClass="max-w-xs" hint="Change this when you change the notice text; new registrations record the version they agreed to."
                  value={r("privacy.noticeVersion")} onChange={(e) => setR("privacy.noticeVersion", e.target.value)} />
              </Panel>
            </>
          )}
          {tab === "reminders" && (
            <Panel title="Automatic reminders">
              <div className="divide-y divide-line">
                <Toggle label="Send reminders" hint="Turn off to stop all automatic messages. Receipts and welcome messages are also paused." checked={!!r("reminders.enabled")} onChange={(v) => setR("reminders.enabled", v)} />
                <div className="grid gap-4 py-4 sm:grid-cols-2">
                  <Input label="Days before expiry" hint="e.g. 7, 3, 0 — 0 means on the last day" value={before} onChange={(e) => setBefore(e.target.value)} />
                  <Input label="Days after expiry (win-back)" hint="e.g. 1, 7" value={after} onChange={(e) => setAfter(e.target.value)} />
                  <Input type="number" min={0} max={30} label="Repeat dues reminder every (days)" hint="0 = don't remind about unpaid invoices" value={r("reminders.duesEveryDays")} onChange={(e) => setR("reminders.duesEveryDays", Math.max(0, Math.min(30, Number(e.target.value) || 0)))} />
                  <Select label="Send from (IST)" value={r("reminders.sendAfterHour")} onChange={(e) => setR("reminders.sendAfterHour", Number(e.target.value))} hint="Messages go out between this time and 9 pm">
                    {Array.from({ length: 15 }, (_, i) => i + 6).map((h) => <option key={h} value={h}>{h <= 12 ? `${h}${h === 12 ? " pm" : " am"}` : `${h - 12} pm`}</option>)}
                  </Select>
                </div>
                <Toggle label="PT reminder the day before" checked={!!r("reminders.ptDayBefore")} onChange={(v) => setR("reminders.ptDayBefore", v)} />
                <Toggle label="Birthday wishes" hint="Only to members who agreed to WhatsApp marketing" checked={!!r("reminders.birthday")} onChange={(v) => setR("reminders.birthday", v)} />
              </div>
              <p className="mt-3 text-sm text-ink-3">Edit the wording on the Messages page.</p>
            </Panel>
          )}
          <ErrorNote error={err} />
        </fieldset>
      )}
      <Toast message={toast} onDone={() => setToast(null)} />
    </>
  );
}
