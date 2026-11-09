"use client";

import Link from "next/link";
import { useState } from "react";
import { Empty, ErrorNote, PageHeader, Panel, Skeleton, Status, cx } from "@/components/ui";
import { useApi, useSession } from "@/lib/session";

interface Trainer { id: string; displayName: string; phone: string | null; branchName: string; designation: string; specializations: string[]; activeMembers: number; ptCompletedThisMonth: number; ptToday: number }
interface M { id: string; fullName: string; memberCode: string; status: string; since: string }

export default function TrainersPage() {
  const { branchId } = useSession();
  const { data, error, loading } = useApi<Trainer[]>(`/trainers${branchId ? `?branchId=${branchId}` : ""}`);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      <PageHeader title="Trainers" description="Who each trainer looks after, and their personal training this month." />
      <ErrorNote error={error} />
      {!data && loading ? <Panel><Skeleton /></Panel> : data && data.length === 0 ? <Panel><Empty title="No trainers yet">Mark a staff member as a trainer to see them here.</Empty></Panel> : (
        <div className="space-y-3">
          {data?.map((t) => (
            <Panel key={t.id} padded={false}>
              <button onClick={() => setOpen(open === t.id ? null : t.id)} aria-expanded={open === t.id} className="flex w-full flex-wrap items-center gap-x-8 gap-y-2 px-4 py-4 text-left hover:bg-surface-2">
                <span className="min-w-48 flex-1">
                  <span className="block font-cond text-xl font-semibold">{t.displayName}</span>
                  <span className="text-sm text-ink-3">{t.designation}, {t.branchName}{t.specializations.length ? `. ${t.specializations.join(", ")}` : ""}</span>
                </span>
                <Num label="Members" value={t.activeMembers} />
                <Num label="PT today" value={t.ptToday} />
                <Num label="PT done this month" value={t.ptCompletedThisMonth} />
                <span className={cx("text-ink-3 transition-transform", open === t.id && "rotate-180")} aria-hidden>▾</span>
              </button>
              {open === t.id && <TrainerMembers id={t.id} />}
            </Panel>
          ))}
        </div>
      )}
    </>
  );
}

function Num({ label, value }: { label: string; value: number }) {
  return <span className="text-right"><span className="block font-cond text-2xl font-semibold leading-none">{value}</span><span className="text-xs text-ink-3">{label}</span></span>;
}

function TrainerMembers({ id }: { id: string }) {
  const { data } = useApi<M[]>(`/trainers/${id}/members`);
  if (!data) return <Skeleton rows={3} />;
  if (data.length === 0) return <p className="border-t border-line px-4 py-3 text-sm text-ink-3">No members assigned yet. Assign from a member's Training tab.</p>;
  return (
    <ul className="grid border-t border-line sm:grid-cols-2 lg:grid-cols-3">
      {data.map((m) => (
        <li key={m.id} className="border-b border-line">
          <Link href={`/members/${m.id}`} className="flex items-center justify-between gap-2 px-4 py-2.5 hover:bg-surface-2">
            <span><span className="block font-medium">{m.fullName}</span><span className="text-xs text-ink-3">{m.memberCode}</span></span>
            <Status value={m.status} />
          </Link>
        </li>
      ))}
    </ul>
  );
}
