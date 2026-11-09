"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, Empty, ErrorNote, PageHeader, Pager, Panel, Skeleton, Table, Td, Th, Toast, cx } from "@/components/ui";
import { api, fmtDate, istToday } from "@/lib/api";
import { useApi, useSession } from "@/lib/session";

interface Row { id: string; memberId: string | null; memberName: string | null; memberCode: string | null; branchName: string; method: string; result: string; denyReason: string | null; overrideReason: string | null; checkInAt: string; checkOutAt: string | null; operatorName: string | null }
interface Res { date: string; page: number; pageSize: number; total: number; summary: { checkIns: number; denied: number; insideNow: number }; data: Row[] }

const REASON: Record<string, string> = {
  NOT_FOUND: "Card not recognised", NO_ACTIVE_SUBSCRIPTION: "No active membership", SUBSCRIPTION_FROZEN: "Membership frozen",
  BRANCH_NOT_ALLOWED: "Not valid at this branch", OUTSIDE_ACCESS_HOURS: "Outside allowed hours", RESTRICTION_FLAG: "Restricted, see desk",
};
const METHOD: Record<string, string> = { QR: "QR", MEMBER_CODE: "Code", PHONE_LOOKUP: "Phone", RFID: "RFID", MANUAL: "Manual", BIOMETRIC: "Biometric" };
const time = (iso: string) => new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(new Date(iso));

export default function AttendancePage() {
  const { branchId, can } = useSession();
  const [date, setDate] = useState(istToday());
  const [filter, setFilter] = useState<"" | "ALLOWED" | "DENIED" | "inside">("");
  const [page, setPage] = useState(1);
  const [toast, setToast] = useState<string | null>(null);
  const qs = [`date=${date}`, `page=${page}`, branchId && `branchId=${branchId}`, filter === "inside" ? "inside=true" : filter && `result=${filter}`].filter(Boolean).join("&");
  const { data, error, loading, reload } = useApi<Res>(`/attendance?${qs}`);
  const isToday = date === istToday();

  async function override(id: string) {
    const reason = window.prompt("Why are you letting this member in? (at least 5 letters)");
    if (!reason || reason.trim().length < 5) return;
    try { await api(`/attendance/${id}/override`, { body: { reason } }); setToast("Let in. The reason is saved in the audit log."); reload(); }
    catch (e) { setToast((e as Error).message); }
  }

  return (
    <>
      <PageHeader title="Attendance" description="Every check-in attempt, including the ones that were refused." />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input type="date" aria-label="Date" value={date} max={istToday()} onChange={(e) => { setDate(e.target.value || istToday()); setPage(1); }}
          className="h-9 rounded-md border border-line bg-surface px-3" />
        <div className="flex gap-1">
          {([["", "All"], ["ALLOWED", "Let in"], ["DENIED", "Refused"], ...(isToday ? [["inside", "Inside now"]] : [])] as [typeof filter, string][]).map(([k, l]) => (
            <button key={k} onClick={() => { setFilter(k); setPage(1); }} aria-pressed={filter === k}
              className={cx("h-8 rounded-md px-3 text-sm font-medium", filter === k ? "bg-ink text-chalk" : "text-ink-2 hover:bg-surface-2")}>{l}</button>
          ))}
        </div>
      </div>
      {data && (
        <div className="mb-6 grid grid-cols-3 overflow-hidden rounded-lg border border-line bg-surface">
          <Stat label={isToday ? "Check-ins today" : `Check-ins on ${fmtDate(date, true)}`} value={data.summary.checkIns} />
          <Stat label="Refused" value={data.summary.denied} tone={data.summary.denied ? "text-red" : undefined} />
          <Stat label="In the gym now" value={isToday ? data.summary.insideNow : "—"} />
        </div>
      )}
      <ErrorNote error={error} />
      <Panel padded={false}>
        {!data && loading ? <Skeleton /> : data && data.data.length === 0 ? <Empty title="No check-ins for this day" /> : data && (
          <div className={cx(loading && "opacity-60")}>
            <Table>
              <thead><tr><Th>Time</Th><Th>Member</Th><Th>Result</Th><Th>How</Th><Th className="hidden md:table-cell">Desk</Th><Th>Left at</Th><Th /></tr></thead>
              <tbody>
                {data.data.map((a) => (
                  <tr key={a.id}>
                    <Td className="whitespace-nowrap font-medium">{time(a.checkInAt)}</Td>
                    <Td>
                      {a.memberId ? <Link href={`/members/${a.memberId}`} className="font-medium hover:underline">{a.memberName}</Link> : <span className="text-ink-3">Unknown card</span>}
                      {a.memberCode && <div className="text-xs text-ink-3">{a.memberCode}, {a.branchName}</div>}
                    </Td>
                    <Td>
                      {a.result === "ALLOWED" ? (
                        <span className="font-medium text-green">{a.overrideReason ? "Let in by manager" : "Let in"}</span>
                      ) : <span className="font-medium text-red">{REASON[a.denyReason ?? ""] ?? "Refused"}</span>}
                      {a.overrideReason && <div className="text-xs text-ink-3">{a.overrideReason}</div>}
                    </Td>
                    <Td className="text-ink-2">{METHOD[a.method] ?? a.method}</Td>
                    <Td className="hidden text-ink-2 md:table-cell">{a.operatorName ?? "—"}</Td>
                    <Td className="text-ink-2">{a.checkOutAt ? time(a.checkOutAt) : a.result === "ALLOWED" ? "—" : ""}</Td>
                    <Td className="text-right">
                      {a.result === "ALLOWED" && !a.checkOutAt && isToday && can("attendance.checkin") && (
                        <Button size="sm" variant="ghost" onClick={async () => { await api(`/attendance/${a.id}/check-out`, { method: "POST" }); reload(); }}>Check out</Button>
                      )}
                      {a.result === "DENIED" && a.memberId && isToday && can("attendance.override") && (
                        <Button size="sm" variant="ghost" onClick={() => override(a.id)}>Let in</Button>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </div>
        )}
      </Panel>
      <Toast message={toast} onDone={() => setToast(null)} />
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className="border-r border-line px-4 py-4 last:border-0">
      <p className="text-sm text-ink-2">{label}</p>
      <p className={cx("mt-1 font-cond text-4xl font-semibold leading-none", tone)}>{value}</p>
    </div>
  );
}
