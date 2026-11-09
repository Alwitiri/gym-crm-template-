"use client";

import { useEffect, useState } from "react";
import { Button, ErrorNote, PageHeader, Panel, Skeleton, Toast } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useApi, useSession } from "@/lib/session";

interface Hours { dayOfWeek: number; opensAt: string; closesAt: string }
interface Branch { id: string; code: string; name: string; addressLine1: string; city: string; phone: string | null; openingHours: Hours[] }
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default function BranchesPage() {
  const { can } = useSession();
  const { data, reload } = useApi<Branch[]>("/branches");
  const [toast, setToast] = useState<string | null>(null);
  return (
    <>
      <PageHeader title="Branches" description="Opening hours decide when members can check in. A day with no hours is closed." />
      {!data ? <Panel><Skeleton /></Panel> : (
        <div className="grid gap-6 lg:grid-cols-2">
          {data.map((b) => <BranchHours key={b.id} branch={b} editable={can("branches.manage")} onSaved={() => { setToast(`${b.name} hours saved`); reload(); }} />)}
        </div>
      )}
      <Toast message={toast} onDone={() => setToast(null)} />
    </>
  );
}

function BranchHours({ branch, editable, onSaved }: { branch: Branch; editable: boolean; onSaved: () => void }) {
  const toRows = (h: Hours[]) => DAYS.map((_, d) => { const x = h.find((r) => r.dayOfWeek === d); return { open: !!x, opensAt: x?.opensAt ?? "05:00", closesAt: x?.closesAt ?? "22:00" }; });
  const [rows, setRows] = useState(toRows(branch.openingHours));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  useEffect(() => setRows(toRows(branch.openingHours)), [branch]);
  const set = (d: number, patch: Partial<(typeof rows)[number]>) => setRows(rows.map((r, i) => (i === d ? { ...r, ...patch } : r)));
  async function save() {
    setBusy(true); setError(null);
    try {
      await api(`/branches/${branch.id}/hours`, { method: "PUT", body: rows.map((r, d) => ({ dayOfWeek: d, opensAt: r.opensAt, closesAt: r.closesAt, open: r.open })).filter((r) => r.open).map(({ open, ...r }) => r) });
      onSaved();
    } catch (e) { setError(e as ApiError); } finally { setBusy(false); }
  }
  return (
    <Panel title={branch.name} actions={<span className="text-sm text-ink-3">{branch.code}</span>}>
      <p className="mb-4 text-sm text-ink-2">{branch.addressLine1}, {branch.city}{branch.phone ? `, ${branch.phone}` : ""}</p>
      <table className="w-full text-sm">
        <tbody>
          {rows.map((r, d) => (
            <tr key={d} className="border-b border-line last:border-0">
              <td className="py-2 pr-3 font-medium">{DAYS[d]}</td>
              <td className="py-2 pr-3">
                <label className="flex items-center gap-2"><input type="checkbox" disabled={!editable} className="size-4 accent-[var(--ink)]" checked={r.open} onChange={(e) => set(d, { open: e.target.checked })} />{r.open ? "Open" : "Closed"}</label>
              </td>
              <td className="py-2">
                {r.open && (
                  <span className="flex items-center gap-2">
                    <input type="time" aria-label={`${DAYS[d]} opens`} disabled={!editable} value={r.opensAt} onChange={(e) => set(d, { opensAt: e.target.value })} className="h-9 rounded-md border border-line bg-surface px-2" />
                    to
                    <input type="time" aria-label={`${DAYS[d]} closes`} disabled={!editable} value={r.closesAt} onChange={(e) => set(d, { closesAt: e.target.value })} className="h-9 rounded-md border border-line bg-surface px-2" />
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ErrorNote error={error} />
      {editable && <div className="mt-4 flex justify-end"><Button onClick={save} busy={busy}>Save hours</Button></div>}
    </Panel>
  );
}
