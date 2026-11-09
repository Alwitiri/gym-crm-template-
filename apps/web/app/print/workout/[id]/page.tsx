"use client";

import { useParams } from "next/navigation";
import { Button, ErrorNote, Skeleton } from "@/components/ui";
import { GOAL, PlanTable, WorkoutPlan } from "@/components/training";
import { fmtDate } from "@/lib/api";
import { useBrand } from "@/lib/brand";
import { useApi } from "@/lib/session";

export default function PrintWorkout() {
  const brand = useBrand();
  const { id } = useParams<{ id: string }>();
  const { data: p, error } = useApi<WorkoutPlan & { memberName: string; memberCode: string }>(`/workout-plans/${id}`);
  if (error) return <ErrorNote error={error} />;
  if (!p) return <Skeleton rows={8} />;
  return (
    <article className="bg-surface print:bg-white">
      <header className="flex items-start justify-between gap-4 border-b-2 border-ink pb-4">
        <div>
          <p className="text-sm text-ink-2">{brand?.brandName}: workout plan for</p>
          <h1 className="text-3xl">{p.memberName}</h1>
          <p className="text-ink-2">{p.memberCode}</p>
        </div>
        <div className="text-right">
          <p className="font-cond text-xl font-semibold">{p.name}</p>
          <p className="text-sm text-ink-2">{GOAL[p.goal]}, from {fmtDate(p.startDate)}</p>
          {p.trainerName && <p className="text-sm text-ink-2">Trainer: {p.trainerName}</p>}
          <Button className="no-print mt-2" size="sm" variant="secondary" onClick={() => window.print()}>Print</Button>
        </div>
      </header>
      <PlanTable plan={p} />
      {p.notes && <p className="mt-6 rounded-md bg-surface-2 p-4 text-sm print:border print:border-line print:bg-white">{p.notes}</p>}
    </article>
  );
}
