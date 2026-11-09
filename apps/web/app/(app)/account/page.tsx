"use client";

import { useState } from "react";
import { Button, ErrorNote, Input, PageHeader, Panel, Table, Td, Th, Toast } from "@/components/ui";
import { api, ApiError, fmtDateTime } from "@/lib/api";
import { useApi, useSession } from "@/lib/session";

interface Sess { id: string; deviceLabel: string; ipAddress: string | null; lastSeenAt: string; current: boolean }

export default function AccountPage() {
  const { me } = useSession();
  const sessions = useApi<Sess[]>("/auth/sessions");
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  async function change(e: React.FormEvent) {
    e.preventDefault();
    if (next !== again) { setErr(new ApiError(400, "MISMATCH", "The two new passwords don't match")); return; }
    setBusy(true); setErr(null);
    try {
      await api("/auth/password", { body: { currentPassword: cur, newPassword: next } });
      setCur(""); setNext(""); setAgain("");
      setToast("Password changed. Other devices were signed out.");
      sessions.reload();
    } catch (e) { setErr(e as ApiError); } finally { setBusy(false); }
  }
  async function revoke(id: string) {
    await api(`/auth/sessions/${id}`, { method: "DELETE" }).catch(() => undefined);
    sessions.reload();
  }

  return (
    <>
      <PageHeader title="My account" description={me.displayName} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Change password">
          <form onSubmit={change} className="flex flex-col gap-4">
            <Input type="password" label="Current password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required />
            <Input type="password" label="New password" hint="At least 10 characters" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={10} />
            <Input type="password" label="New password again" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required />
            <ErrorNote error={err} />
            <Button type="submit" busy={busy} className="self-start">Change password</Button>
          </form>
        </Panel>
        <Panel title="Where you're signed in" padded={false}>
          <Table>
            <thead><tr><Th>Device</Th><Th>Last active</Th><Th /></tr></thead>
            <tbody>
              {(sessions.data ?? []).map((s) => (
                <tr key={s.id}>
                  <Td>{s.deviceLabel}{s.current && <span className="ml-2 text-xs font-semibold text-green">This device</span>}<div className="text-xs text-ink-3">{s.ipAddress}</div></Td>
                  <Td className="text-ink-2">{fmtDateTime(s.lastSeenAt)}</Td>
                  <Td className="text-right">{!s.current && <Button size="sm" variant="ghost" onClick={() => revoke(s.id)}>Sign out</Button>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      </div>
      <Toast message={toast} onDone={() => setToast(null)} />
    </>
  );
}
