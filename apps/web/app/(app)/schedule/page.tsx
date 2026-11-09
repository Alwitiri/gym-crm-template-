"use client";

import { useMemo, useState } from "react";
import { Button, Empty, ErrorNote, PageHeader, Panel, Select, Skeleton, Toast, cx } from "@/components/ui";
import { PtSession, SessionRow } from "@/components/training";
import { istToday } from "@/lib/api";
import { useApi, useSession } from "@/lib/session";

interface Trainer { id: string; displayName: string }
const addDays = (ymd: string, n: number) => { const d = new Date(ymd + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dayName = (ymd: string) => new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(ymd + "T00:00:00Z"));
const istDay = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(iso));

export default function SchedulePage() {
  const { can, branchId, me } = useSession();
  const [start, setStart] = useState(istToday());
  const [trainerId, setTrainerId] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const end = addDays(start, 6);
  const allTrainers = can("pt.read");
  const { data: trainers } = useApi<Trainer[]>(allTrainers && can("trainers.read") ? "/trainers" : null);
  const { data, error, loading, reload } = useApi<{ data: PtSession[] }>(`/pt-sessions?from=${start}&to=${end}${trainerId ? `&trainerId=${trainerId}` : ""}${branchId ? `&branchId=${branchId}` : ""}`);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(start, i)), [start]);
  const byDay = useMemo(() => {
    const m = new Map<string, PtSession[]>();
    for (const s of data?.data ?? []) m.set(istDay(s.scheduledStart), [...(m.get(istDay(s.scheduledStart)) ?? []), s]);
    return m;
  }, [data]);
  const booked = (data?.data ?? []).filter((s) => s.status === "SCHEDULED").length;
  const done = (data?.data ?? []).filter((s) => s.status === "COMPLETED").length;

  return (
    <>
      <PageHeader
        title={allTrainers ? "PT schedule" : "My PT sessions"}
        description={data ? `${booked} booked and ${done} done this week. Book sessions from a member's Personal training tab.` : undefined}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => setStart(addDays(start, -7))} aria-label="Previous week">←</Button>
            <Button variant="secondary" size="sm" onClick={() => setStart(istToday())}>This week</Button>
            <Button variant="secondary" size="sm" onClick={() => setStart(addDays(start, 7))} aria-label="Next week">→</Button>
          </div>
        }
      />
      {allTrainers && trainers && trainers.length > 1 && (
        <div className="mb-4 max-w-xs">
          <Select label="Trainer" value={trainerId} onChange={(e) => setTrainerId(e.target.value)}>
            <option value="">All trainers</option>
            {trainers.map((t) => <option key={t.id} value={t.id}>{t.displayName}</option>)}
          </Select>
        </div>
      )}
      <ErrorNote error={error} />
      {!data && loading ? <Panel><Skeleton rows={6} /></Panel> : (
        <div className={cx("space-y-4", loading && "opacity-60")}>
          {days.map((d) => {
            const list = byDay.get(d) ?? [];
            const isToday = d === istToday();
            return (
              <Panel key={d} padded={false} title={`${isToday ? "Today, " : ""}${dayName(d)}`} actions={<span className="text-sm text-ink-3">{list.length ? `${list.length} session${list.length > 1 ? "s" : ""}` : ""}</span>}>
                {list.length === 0 ? <p className="px-4 py-3 text-sm text-ink-3">Nothing booked.</p> : (
                  <ul>{list.map((s) => <SessionRow key={s.id} s={s} showMember onChanged={(m) => { setToast(m); reload(); }} />)}</ul>
                )}
              </Panel>
            );
          })}
          {data && data.data.length === 0 && !allTrainers && !me.staffId && <Empty title="No sessions" />}
        </div>
      )}
      <Toast message={toast} onDone={() => setToast(null)} />
    </>
  );
}
