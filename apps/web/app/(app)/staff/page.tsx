"use client";

import { useState } from "react";
import { Button, Dialog, Empty, ErrorNote, Input, PageHeader, Panel, Select, Skeleton, Table, Td, Th, Toast } from "@/components/ui";
import { api, ApiError, fmtDate } from "@/lib/api";
import { useApi, useSession } from "@/lib/session";

interface Staff {
  id: string; userId: string; employeeCode: string | null; displayName: string; email: string | null; phone: string | null; designation: string;
  branchId: string; isTrainer: boolean; specializations: string[]; employmentStatus: string; joinedOn: string; roles: { roleKey: string; branchId: string | null }[];
}
const ROLE_LABEL: Record<string, string> = { OWNER: "Owner", GYM_ADMIN: "Admin (all branches)", BRANCH_MANAGER: "Branch manager", RECEPTIONIST: "Front desk", TRAINER: "Trainer", ACCOUNTANT: "Accounts" };
const ROLE_HINT: Record<string, string> = {
  OWNER: "Everything, including settings and staff.", GYM_ADMIN: "Runs every branch; can't change business settings.", BRANCH_MANAGER: "Runs one branch: staff, plans, discounts, reports.",
  RECEPTIONIST: "Registers members, sells plans, takes payments, checks people in.", TRAINER: "Sees only their own members: plans, diet, PT sessions.", ACCOUNTANT: "Payments, expenses and finance reports.",
};
const genPassword = () => {
  const a = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const r = crypto.getRandomValues(new Uint32Array(12));
  return Array.from(r, (n) => a[n % a.length]).join("") + "@7";
};

export default function StaffPage() {
  const { can, branches, me } = useSession();
  const { data, error, loading, reload } = useApi<Staff[]>("/staff");
  const [edit, setEdit] = useState<Staff | "new" | null>(null);
  const [reset, setReset] = useState<Staff | null>(null);
  const [remove, setRemove] = useState<Staff | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const branchName = (id: string | null) => (id ? branches.find((b) => b.id === id)?.name ?? "—" : "All branches");
  const manage = can("staff.manage");

  return (
    <>
      <PageHeader title="Staff" description="Who can sign in, and what each person can see and do."
        actions={manage && <Button onClick={() => setEdit("new")}>Add staff</Button>} />
      <ErrorNote error={error} />
      <Panel padded={false}>
        {!data && loading ? <Skeleton /> : data && data.length === 0 ? <Empty title="No staff yet" /> : data && (
          <Table>
            <thead><tr><Th>Name</Th><Th>Role</Th><Th>Branch</Th><Th>Sign-in</Th><Th>Joined</Th><Th /></tr></thead>
            <tbody>
              {data.map((s) => (
                <tr key={s.id}>
                  <Td><span className="font-medium">{s.displayName}</span><div className="text-xs text-ink-3">{s.designation}{s.isTrainer && !/trainer/i.test(s.designation) && " · trainer"}</div></Td>
                  <Td>{s.roles.map((r, i) => <div key={i}>{ROLE_LABEL[r.roleKey] ?? r.roleKey}{r.branchId && s.roles.length > 1 ? <span className="text-ink-3"> · {branchName(r.branchId)}</span> : null}</div>)}</Td>
                  <Td className="text-ink-2">{branchName(s.branchId)}</Td>
                  <Td className="text-ink-2">{s.email ?? s.phone}</Td>
                  <Td className="text-ink-2">{fmtDate(s.joinedOn)}</Td>
                  <Td className="text-right">
                    {manage && s.userId !== me.id && (
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setEdit(s)}>Edit</Button>
                        <Button size="sm" variant="ghost" onClick={() => setReset(s)}>Reset password</Button>
                        <Button size="sm" variant="ghost" className="text-red" onClick={() => setRemove(s)}>Remove</Button>
                      </div>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
      {edit && <StaffDialog staff={edit === "new" ? null : edit} onClose={() => setEdit(null)} onSaved={(m) => { setEdit(null); setToast(m); reload(); }} />}
      {reset && <ResetDialog staff={reset} onClose={() => setReset(null)} />}
      {remove && <RemoveDialog staff={remove} trainers={(data ?? []).filter((t) => t.isTrainer && t.id !== remove.id)} onClose={() => setRemove(null)} onDone={(m) => { setRemove(null); setToast(m); reload(); }} />}
      <Toast message={toast} onDone={() => setToast(null)} />
    </>
  );
}

function StaffDialog({ staff, onClose, onSaved }: { staff: Staff | null; onClose: () => void; onSaved: (msg: string) => void }) {
  const { branches, me } = useSession();
  const allBranches = me.branchIds === "*";
  const [f, setF] = useState({
    displayName: staff?.displayName ?? "", email: staff?.email ?? "", phone: staff?.phone ?? "", designation: staff?.designation ?? "",
    branchId: staff?.branchId ?? branches[0]?.id ?? "", roleKey: staff?.roles[0]?.roleKey ?? "RECEPTIONIST",
    roleScope: staff?.roles[0] ? (staff.roles[0].branchId ?? "*") : (branches[0]?.id ?? ""), isTrainer: staff?.isTrainer ?? false, specializations: staff?.specializations.join(", ") ?? "",
  });
  const [password] = useState(genPassword);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const [created, setCreated] = useState(false);
  const set = (k: keyof typeof f, v: any) => setF((x) => ({ ...x, [k]: v }));
  const wide = f.roleKey === "OWNER" || f.roleKey === "GYM_ADMIN";
  const roles = [{ roleKey: f.roleKey, branchId: wide ? null : f.roleScope === "*" ? null : f.roleScope || f.branchId }];
  const specs = f.specializations.split(",").map((s) => s.trim()).filter(Boolean);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      if (staff) {
        const changedRoles = JSON.stringify(roles) !== JSON.stringify(staff.roles);
        await api(`/staff/${staff.id}`, { method: "PATCH", body: { displayName: f.displayName, designation: f.designation, isTrainer: f.isTrainer || f.roleKey === "TRAINER", specializations: specs, ...(changedRoles ? { roles } : {}) } });
        onSaved(changedRoles ? `${f.displayName} updated. They'll need to sign in again.` : `${f.displayName} updated`);
      } else {
        await api("/staff", { body: { displayName: f.displayName, email: f.email || undefined, phone: f.phone, designation: f.designation, branchId: f.branchId, isTrainer: f.isTrainer || f.roleKey === "TRAINER", specializations: specs, roles, initialPassword: password } });
        setCreated(true);
      }
    } catch (e) { setErr(e as ApiError); } finally { setBusy(false); }
  }
  const fe = err?.fieldErrors() ?? {};

  if (created) {
    return (
      <Dialog open onClose={() => onSaved(`${f.displayName} added`)} title="Staff added">
        <p>Give {f.displayName.split(" ")[0]} these sign-in details. They should change the password from <b>My account</b> after signing in.</p>
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-md bg-surface-2 p-4">
          <dt className="text-ink-3">Sign in with</dt><dd className="font-medium">{f.email || f.phone}</dd>
          <dt className="text-ink-3">Password</dt><dd className="font-mono text-lg">{password}</dd>
        </dl>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => navigator.clipboard?.writeText(`Sign in at ${location.origin}/login\nUser: ${f.email || f.phone}\nPassword: ${password}`)}>Copy</Button>
          <Button onClick={() => onSaved(`${f.displayName} added`)}>Done</Button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog open onClose={onClose} title={staff ? `Edit ${staff.displayName}` : "Add staff"} wide>
      <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        <Input label="Full name" value={f.displayName} onChange={(e) => set("displayName", e.target.value)} required error={fe.displayName} />
        <Input label="Job title" placeholder="Front desk, Trainer…" value={f.designation} onChange={(e) => set("designation", e.target.value)} required error={fe.designation} />
        {!staff && <Input label="Mobile number" inputMode="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} required error={fe.phone} />}
        {!staff && <Input label="Email (optional)" type="email" value={f.email} onChange={(e) => set("email", e.target.value)} error={fe.email} hint="They can sign in with either" />}
        {!staff && (
          <Select label="Works at" value={f.branchId} onChange={(e) => { set("branchId", e.target.value); if (f.roleScope !== "*") set("roleScope", e.target.value); }}>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        )}
        <Select label="Access" value={f.roleKey} onChange={(e) => set("roleKey", e.target.value)} hint={ROLE_HINT[f.roleKey]}>
          {Object.entries(ROLE_LABEL).filter(([k]) => allBranches || !["OWNER", "GYM_ADMIN"].includes(k)).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </Select>
        {!wide && branches.length > 1 && (
          <Select label="For branch" value={f.roleScope} onChange={(e) => set("roleScope", e.target.value)}>
            {allBranches && <option value="*">All branches</option>}
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        )}
        {(f.roleKey === "TRAINER" || f.isTrainer) && <Input label="Specialisations" hint="Comma separated, e.g. Strength, Weight loss" value={f.specializations} onChange={(e) => set("specializations", e.target.value)} />}
        {f.roleKey !== "TRAINER" && (
          <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={f.isTrainer} onChange={(e) => set("isTrainer", e.target.checked)} /> Also takes members as a trainer</label>
        )}
        <div className="sm:col-span-2"><ErrorNote error={err} /></div>
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" busy={busy}>{staff ? "Save" : "Add and create password"}</Button>
        </div>
      </form>
    </Dialog>
  );
}

function ResetDialog({ staff, onClose }: { staff: Staff; onClose: () => void }) {
  const [password] = useState(genPassword);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  async function go() {
    setBusy(true); setErr(null);
    try { await api(`/staff/${staff.id}/reset-password`, { body: { newPassword: password } }); setDone(true); } catch (e) { setErr(e as ApiError); } finally { setBusy(false); }
  }
  return (
    <Dialog open onClose={onClose} title={`Reset password for ${staff.displayName}`}>
      {done ? (
        <>
          <p>New password for <b>{staff.email ?? staff.phone}</b>. They've been signed out everywhere.</p>
          <p className="mt-3 rounded-md bg-surface-2 p-4 font-mono text-lg">{password}</p>
          <div className="mt-5 flex justify-end"><Button onClick={onClose}>Done</Button></div>
        </>
      ) : (
        <>
          <p>This signs {staff.displayName.split(" ")[0]} out of every device and gives them a new password to use.</p>
          <ErrorNote error={err} />
          <div className="mt-5 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={go} busy={busy}>Reset password</Button></div>
        </>
      )}
    </Dialog>
  );
}

function RemoveDialog({ staff, trainers, onClose, onDone }: { staff: Staff; trainers: Staff[]; onClose: () => void; onDone: (m: string) => void }) {
  const [to, setTo] = useState("");
  const [needs, setNeeds] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  async function go() {
    setBusy(true); setErr(null);
    try {
      const r = await api<{ membersMoved: number }>(`/staff/${staff.id}/deactivate`, { body: { reassignMembersToTrainerId: to || undefined, reason: "Left" } });
      onDone(`${staff.displayName} removed${r.membersMoved ? `; ${r.membersMoved} members moved` : ""}`);
    } catch (e) {
      const ae = e as ApiError;
      if (ae.code === "HAS_MEMBERS") setNeeds(ae.extra.activeMembers);
      else setErr(ae);
    } finally { setBusy(false); }
  }
  return (
    <Dialog open onClose={onClose} title={`Remove ${staff.displayName}?`}>
      <p>They won't be able to sign in any more. Their past work (sales, check-ins, notes) stays on record.</p>
      {needs != null && (
        <div className="mt-4">
          <p className="mb-2 font-medium">{staff.displayName.split(" ")[0]} looks after {needs} members. Who takes them over?</p>
          <Select label="New trainer" value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">Choose…</option>
            {trainers.map((t) => <option key={t.id} value={t.id}>{t.displayName}</option>)}
          </Select>
        </div>
      )}
      <ErrorNote error={err} />
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="danger" onClick={go} busy={busy} disabled={needs != null && !to}>Remove</Button>
      </div>
    </Dialog>
  );
}
