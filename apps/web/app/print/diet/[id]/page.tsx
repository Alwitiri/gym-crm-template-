"use client";

import { useParams } from "next/navigation";
import { Button, ErrorNote, Skeleton } from "@/components/ui";
import type { DietPlan } from "@/components/training";
import { fmtDate } from "@/lib/api";
import { useBrand } from "@/lib/brand";
import { useApi } from "@/lib/session";

export default function PrintDiet() {
  const brand = useBrand();
  const { id } = useParams<{ id: string }>();
  const { data: p, error } = useApi<DietPlan & { memberName: string; memberCode: string }>(`/diet-plans/${id}`);
  if (error) return <ErrorNote error={error} />;
  if (!p) return <Skeleton rows={8} />;
  return (
    <article>
      <header className="flex items-start justify-between gap-4 border-b-2 border-ink pb-4">
        <div>
          <p className="text-sm text-ink-2">{brand?.brandName}: diet plan for</p>
          <h1 className="text-3xl">{p.memberName}</h1>
          <p className="text-ink-2">{p.memberCode}</p>
        </div>
        <div className="text-right">
          <p className="font-cond text-xl font-semibold">{p.name}</p>
          <p className="text-sm text-ink-2">From {fmtDate(p.startDate)}{p.trainerName ? `, by ${p.trainerName}` : ""}</p>
          <Button className="no-print mt-2" size="sm" variant="secondary" onClick={() => window.print()}>Print</Button>
        </div>
      </header>
      <p className="mt-4 flex flex-wrap gap-x-6 text-sm">
        {p.dailyCalories && <span><strong className="font-cond text-xl">{p.dailyCalories}</strong> kcal a day</span>}
        {p.proteinG && <span><strong className="font-cond text-xl">{p.proteinG}</strong> g protein</span>}
        {p.allergies.length > 0 && <span>Avoid: {p.allergies.join(", ")}</span>}
      </p>
      <table className="mt-4 w-full text-sm">
        <tbody>
          {p.meals.map((m, i) => (
            <tr key={i} className="border-b border-line align-top">
              <td className="w-20 py-3 font-cond text-lg font-semibold">{m.mealTime}</td>
              <td className="w-28 py-3 font-medium">{m.label}</td>
              <td className="py-3">
                <ul className="space-y-0.5">
                  {m.items.map((it, j) => (
                    <li key={j}>{it.food}{it.portion ? `, ${it.portion}` : ""}<span className="text-ink-3">{it.calories ? `, ${it.calories} kcal` : ""}{it.proteinG ? `, ${it.proteinG} g protein` : ""}</span></li>
                  ))}
                </ul>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {p.notes && <p className="mt-6 rounded-md bg-surface-2 p-4 text-sm print:border print:border-line print:bg-white">{p.notes}</p>}
    </article>
  );
}
