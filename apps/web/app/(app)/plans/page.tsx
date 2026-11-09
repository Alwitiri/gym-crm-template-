"use client";

import { useState } from "react";
import { Button, Dialog, ErrorNote, Input, MoneyInput, PageHeader, Panel, Skeleton, Status, Table, Td, Th } from "@/components/ui";
import { api, ApiError, rupees, toPaise } from "@/lib/api";
import { useApi, useSession } from "@/lib/session";

interface Plan {
  id: string; name: string; description: string | null; durationDays: number; pricePaise: number; registrationFeePaise: number; taxRateBp: number;
  maxDiscountPaise: number; freezeAllowed: boolean; maxFreezeDays: number; maxFreezeCount: number; allBranchAccess: boolean; branchIds: string[];
  accessStartTime: string | null; accessEndTime: string | null; status: string; activeSubscriptions: number;
}

const duration = (d: number) => (d % 365 === 0 ? `${d / 365} year${d > 365 ? "s" : ""}` : d % 30 === 0 ? `${d / 30} month${d > 30 ? "s" : ""}` : `${d} days`);

export default function PlansPage() {
  const { can, branches } = useSession();
  const { data, error, loading, reload } = useApi<Plan[]>("/membership-plans");
  const [editing, setEditing] = useState<Plan | "new" | null>(null);
  const branchName = (ids: string[]) => ids.map((id) => branches.find((b) => b.id === id)?.name).filter(Boolean).join(", ");

  return (
    <>
      <PageHeader title="Membership plans" description="Prices exclude GST. Changing a plan never changes memberships already sold."
        actions={can("plans.manage") && <Button onClick={() => setEditing("new")}>New plan</Button>} />
      <ErrorNote error={error} />
      <Panel padded={false}>
        {!data && loading ? <Skeleton /> : data && (
          <Table>
            <thead><tr><Th>Plan</Th><Th>Length</Th><Th className="text-right">Price</Th><Th className="text-right">With GST</Th><Th>Freeze</Th><Th>Where</Th><Th className="text-right">Active</Th><Th>Status</Th>{can("plans.manage") && <Th />}</tr></thead>
            <tbody>
              {data.map((p) => (
                <tr key={p.id}>
                  <Td><span className="font-medium">{p.name}</span>{p.accessStartTime && <div className="text-xs text-ink-3">{p.accessStartTime}–{p.accessEndTime} only</div>}</Td>
                  <Td>{duration(p.durationDays)}</Td>
                  <Td className="text-right">{rupees(p.pricePaise)}</Td>
                  <Td className="text-right text-ink-2">{rupees(Math.round((p.pricePaise * (10000 + p.taxRateBp)) / 10000 / 100) * 100)}</Td>
                  <Td className="text-ink-2">{p.freezeAllowed ? `${p.maxFreezeDays} days, ${p.maxFreezeCount}×` : "No"}</Td>
                  <Td className="text-ink-2">{p.allBranchAccess ? "All branches" : branchName(p.branchIds) || "—"}</Td>
                  <Td className="text-right">{p.activeSubscriptions}</Td>
                  <Td><Status value={p.status} /></Td>
                  {can("plans.manage") && <Td className="text-right"><Button size="sm" variant="ghost" onClick={() => setEditing(p)}>Edit</Button></Td>}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
      {editing && <PlanDialog plan={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
      {(can("pt.read") || can("pt.sell")) && <PtPackages />}
    </>
  );
}

interface PtPkg { id: string; name: string; sessionCount: number; validityDays: number; pricePaise: number; taxRateBp: number; status: string }

function PtPackages() {
  const { can } = useSession();
  const { data, reload } = useApi<PtPkg[]>("/pt-packages");
  const [editing, setEditing] = useState<PtPkg | "new" | null>(null);
  return (
    <div className="mt-10">
      <PageHeader title="Personal training packages" description="Sold from a member's Personal training tab. Prices exclude GST."
        actions={can("pt.packages.manage") && <Button onClick={() => setEditing("new")}>New package</Button>} />
      <Panel padded={false}>
        {!data ? <Skeleton rows={3} /> : (
          <Table>
            <thead><tr><Th>Package</Th><Th>Sessions</Th><Th>Use within</Th><Th className="text-right">Price</Th><Th className="text-right">Per session</Th><Th>Status</Th>{can("pt.packages.manage") && <Th />}</tr></thead>
            <tbody>
              {data.map((p) => (
                <tr key={p.id}>
                  <Td className="font-medium">{p.name}</Td>
                  <Td>{p.sessionCount}</Td>
                  <Td>{p.validityDays} days</Td>
                  <Td className="text-right">{rupees(p.pricePaise)}</Td>
                  <Td className="text-right text-ink-2">{rupees(Math.round(p.pricePaise / p.sessionCount / 100) * 100)}</Td>
                  <Td><Status value={p.status} /></Td>
                  {can("pt.packages.manage") && <Td className="text-right"><Button size="sm" variant="ghost" onClick={() => setEditing(p)}>Edit</Button></Td>}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
      {editing && <PtPackageDialog pkg={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </div>
  );
}

function PtPackageDialog({ pkg, onClose, onSaved }: { pkg: PtPkg | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: pkg?.name ?? "", sessionCount: String(pkg?.sessionCount ?? 10), validityDays: String(pkg?.validityDays ?? 45), price: pkg ? String(pkg.pricePaise / 100) : "", active: pkg ? pkg.status === "ACTIVE" : true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api(pkg ? `/pt-packages/${pkg.id}` : "/pt-packages", { method: pkg ? "PATCH" : "POST", body: { name: f.name, sessionCount: Number(f.sessionCount), validityDays: Number(f.validityDays), pricePaise: toPaise(f.price), status: f.active ? "ACTIVE" : "INACTIVE" } });
      onSaved();
    } catch (err) { setError(err as ApiError); setBusy(false); }
  }
  return (
    <Dialog open onClose={onClose} title={pkg ? `Edit ${pkg.name}` : "New PT package"}>
      <form onSubmit={save} className="space-y-4">
        <Input label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="PT 12 sessions" required />
        <div className="grid gap-3 sm:grid-cols-3">
          <Input label="Sessions" type="number" min={1} value={f.sessionCount} onChange={(e) => setF({ ...f, sessionCount: e.target.value })} />
          <Input label="Use within (days)" type="number" min={1} value={f.validityDays} onChange={(e) => setF({ ...f, validityDays: e.target.value })} />
          <MoneyInput label="Price before GST" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />
        </div>
        <label className="flex items-center gap-2.5 text-sm"><input type="checkbox" className="size-4 accent-[var(--ink)]" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />Available to sell</label>
        <ErrorNote error={error} />
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" busy={busy} disabled={!f.name || !f.price}>{pkg ? "Save changes" : "Create package"}</Button>
        </div>
      </form>
    </Dialog>
  );
}

function PlanDialog({ plan, onClose, onSaved }: { plan: Plan | null; onClose: () => void; onSaved: () => void }) {
  const { branches } = useSession();
  const [f, setF] = useState({
    name: plan?.name ?? "", durationDays: String(plan?.durationDays ?? 30), price: plan ? String(plan.pricePaise / 100) : "",
    reg: plan ? String(plan.registrationFeePaise / 100) : "200", maxDiscount: plan ? String(plan.maxDiscountPaise / 100) : "0",
    freezeAllowed: plan?.freezeAllowed ?? false, maxFreezeDays: String(plan?.maxFreezeDays ?? 0), maxFreezeCount: String(plan?.maxFreezeCount ?? 0),
    allBranchAccess: plan?.allBranchAccess ?? true, branchIds: plan?.branchIds ?? [], accessStartTime: plan?.accessStartTime ?? "", accessEndTime: plan?.accessEndTime ?? "",
    active: plan ? plan.status === "ACTIVE" : true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const body = {
      name: f.name, durationDays: Number(f.durationDays), pricePaise: toPaise(f.price), registrationFeePaise: toPaise(f.reg || "0"),
      maxDiscountPaise: toPaise(f.maxDiscount || "0"), freezeAllowed: f.freezeAllowed, maxFreezeDays: Number(f.maxFreezeDays) || 0, maxFreezeCount: Number(f.maxFreezeCount) || 0,
      allBranchAccess: f.allBranchAccess, branchIds: f.allBranchAccess ? [] : f.branchIds,
      accessStartTime: f.accessStartTime || null, accessEndTime: f.accessEndTime || null, status: f.active ? "ACTIVE" : "INACTIVE",
    };
    try {
      await api(plan ? `/membership-plans/${plan.id}` : "/membership-plans", { method: plan ? "PATCH" : "POST", body });
      onSaved();
    } catch (err) { setError(err as ApiError); setBusy(false); }
  }
  const fe = error?.fieldErrors() ?? {};
  return (
    <Dialog open onClose={onClose} title={plan ? `Edit ${plan.name}` : "New plan"} wide>
      <form onSubmit={save} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Input label="Name" wrapClass="sm:col-span-2" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} error={fe.name} />
          <Input label="Length in days" type="number" min={1} value={f.durationDays} onChange={(e) => setF({ ...f, durationDays: e.target.value })} error={fe.durationDays} />
          <MoneyInput label="Price before GST" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} error={fe.pricePaise} />
          <MoneyInput label="Registration fee" value={f.reg} onChange={(e) => setF({ ...f, reg: e.target.value })} hint="Charged on a member's first purchase." />
          <MoneyInput label="Most staff can discount" value={f.maxDiscount} onChange={(e) => setF({ ...f, maxDiscount: e.target.value })} />
          <Input label="Entry from" type="time" value={f.accessStartTime} onChange={(e) => setF({ ...f, accessStartTime: e.target.value })} hint="Empty = branch hours" />
          <Input label="Entry until" type="time" value={f.accessEndTime} onChange={(e) => setF({ ...f, accessEndTime: e.target.value })} />
        </div>
        <fieldset className="rounded-lg border border-line p-4">
          <label className="flex items-center gap-2.5 text-sm font-medium"><input type="checkbox" className="size-4 accent-[var(--ink)]" checked={f.freezeAllowed} onChange={(e) => setF({ ...f, freezeAllowed: e.target.checked })} />Members can freeze this plan</label>
          {f.freezeAllowed && (
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <Input label="Up to (days in total)" type="number" min={0} value={f.maxFreezeDays} onChange={(e) => setF({ ...f, maxFreezeDays: e.target.value })} />
              <Input label="How many times" type="number" min={0} value={f.maxFreezeCount} onChange={(e) => setF({ ...f, maxFreezeCount: e.target.value })} />
            </div>
          )}
        </fieldset>
        <fieldset className="rounded-lg border border-line p-4">
          <label className="flex items-center gap-2.5 text-sm font-medium"><input type="checkbox" className="size-4 accent-[var(--ink)]" checked={f.allBranchAccess} onChange={(e) => setF({ ...f, allBranchAccess: e.target.checked })} />Sold at and valid in every branch</label>
          {!f.allBranchAccess && (
            <div className="mt-3 flex flex-wrap gap-4">
              {branches.map((b) => (
                <label key={b.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="size-4 accent-[var(--ink)]" checked={f.branchIds.includes(b.id)}
                    onChange={(e) => setF({ ...f, branchIds: e.target.checked ? [...f.branchIds, b.id] : f.branchIds.filter((x) => x !== b.id) })} />
                  {b.name}
                </label>
              ))}
            </div>
          )}
        </fieldset>
        <label className="flex items-center gap-2.5 text-sm"><input type="checkbox" className="size-4 accent-[var(--ink)]" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />Available to sell</label>
        <ErrorNote error={error} />
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" busy={busy}>{plan ? "Save changes" : "Create plan"}</Button>
        </div>
      </form>
    </Dialog>
  );
}
