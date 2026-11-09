"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api, ApiError, daysUntil, fmtDate, fmtDateTime, istToday, newKey, rupees, toPaise } from "@/lib/api";
import { useApi, useSession } from "@/lib/session";
import { Button, Dialog, Empty, ErrorNote, Input, MoneyInput, Panel, Select, Skeleton, Table, Td, Textarea, Th, cx } from "./ui";

// ---------------------------------------------------------------- types
export interface Exercise { id: string; name: string; muscleGroup: string; equipment: string | null }
export interface WorkoutPlan {
  id: string; name: string; goal: string; startDate: string; endDate: string | null; notes: string | null; isActive: boolean; trainerName: string | null; updatedAt: string;
  exercises: { exerciseId: string; name: string; muscleGroup: string; dayLabel: string | null; sets: number; reps: string; weightKg: number | null; restSeconds: number | null; notes: string | null }[];
}
export interface DietPlan {
  id: string; name: string; startDate: string; dailyCalories: number | null; proteinG: number | null; carbsG: number | null; fatG: number | null;
  preferences: string[]; allergies: string[]; notes: string | null; isActive: boolean; trainerName: string | null;
  meals: { mealTime: string; label: string; items: { food: string; portion?: string; calories?: number; proteinG?: number }[] }[];
}
interface Metric { id: string; measuredOn: string; weightKg: number | null; heightCm: number | null; bodyFatPct: number | null; waistCm: number | null; chestCm: number | null; notes: string | null }
interface Trainer { id: string; displayName: string; branchName: string; activeMembers: number }

export const GOAL: Record<string, string> = { FAT_LOSS: "Fat loss", MUSCLE_GAIN: "Muscle gain", STRENGTH: "Strength", ENDURANCE: "Endurance", GENERAL: "General fitness" };
const PREF: Record<string, string> = { VEG: "Vegetarian", EGGETARIAN: "Eggetarian", NON_VEG: "Non-veg", JAIN: "Jain", VEGAN: "Vegan" };

// ---------------------------------------------------------------- trainer
export function TrainerPanel({ memberId, current, onChanged }: { memberId: string; current: { id: string; displayName: string } | null; onChanged: (msg: string) => void }) {
  const { can } = useSession();
  const { data: trainers } = useApi<Trainer[]>(can("trainers.assign") ? "/trainers" : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  async function change(trainerId: string) {
    setBusy(true); setError(null);
    try {
      await api(`/members/${memberId}/trainer`, { method: "PUT", body: { trainerId: trainerId || null } });
      onChanged(trainerId ? `Trainer set to ${trainers?.find((t) => t.id === trainerId)?.displayName}` : "Trainer removed");
    } catch (e) { setError(e as ApiError); } finally { setBusy(false); }
  }
  return (
    <Panel title="Trainer">
      {can("trainers.assign") ? (
        <Select label="Assigned trainer" value={current?.id ?? ""} disabled={busy || !trainers} onChange={(e) => change(e.target.value)}
          hint="The trainer sees this member's plans and progress.">
          <option value="">No trainer</option>
          {trainers?.map((t) => <option key={t.id} value={t.id}>{t.displayName} ({t.branchName}, {t.activeMembers} members)</option>)}
        </Select>
      ) : <p>{current?.displayName ?? <span className="text-ink-3">No trainer assigned</span>}</p>}
      <ErrorNote error={error} />
    </Panel>
  );
}

// ---------------------------------------------------------------- workouts
export function WorkoutSection({ memberId, canWrite }: { memberId: string; canWrite: boolean }) {
  const { data, reload, loading } = useApi<WorkoutPlan[]>(`/members/${memberId}/workout-plans`);
  const [editing, setEditing] = useState<WorkoutPlan | "new" | null>(null);
  const active = data?.find((p) => p.isActive);
  const older = data?.filter((p) => !p.isActive) ?? [];
  return (
    <Panel title="Workout plan" padded={false}
      actions={canWrite && <div className="flex gap-2">{active && <Button size="sm" variant="secondary" onClick={() => setEditing(active)}>Edit</Button>}<Button size="sm" onClick={() => setEditing("new")}>New plan</Button></div>}>
      {!data && loading ? <Skeleton rows={3} /> : !active ? (
        <Empty title="No current workout plan">{canWrite ? "Create one from the exercise library." : "The member's trainer can add one."}</Empty>
      ) : (
        <div>
          <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-4">
            <div>
              <p className="font-cond text-xl font-semibold">{active.name}</p>
              <p className="text-sm text-ink-3">{GOAL[active.goal]}, from {fmtDate(active.startDate)}{active.trainerName ? `, by ${active.trainerName}` : ""}</p>
            </div>
            <Link href={`/print/workout/${active.id}`} target="_blank" className="text-sm text-blue hover:underline">Print</Link>
          </div>
          <PlanTable plan={active} />
          {active.notes && <p className="border-t border-line px-4 py-3 text-sm text-ink-2">{active.notes}</p>}
        </div>
      )}
      {older.length > 0 && (
        <details className="border-t border-line px-4 py-3 text-sm">
          <summary className="cursor-pointer text-ink-2">{older.length} earlier plan{older.length > 1 ? "s" : ""}</summary>
          <ul className="mt-2 space-y-1">
            {older.map((p) => <li key={p.id}><Link href={`/print/workout/${p.id}`} target="_blank" className="hover:underline">{p.name}</Link> <span className="text-ink-3">from {fmtDate(p.startDate)}</span></li>)}
          </ul>
        </details>
      )}
      {editing && <WorkoutEditor memberId={memberId} plan={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </Panel>
  );
}

export function PlanTable({ plan }: { plan: WorkoutPlan }) {
  const groups = useMemo(() => {
    const g: { day: string; rows: WorkoutPlan["exercises"] }[] = [];
    for (const e of plan.exercises) {
      const day = e.dayLabel || "Every session";
      const last = g[g.length - 1];
      if (last && last.day === day) last.rows.push(e); else g.push({ day, rows: [e] });
    }
    return g;
  }, [plan]);
  return (
    <div className="mt-3">
      {groups.map((g) => (
        <div key={g.day}>
          <p className="border-y border-line bg-surface-2/60 px-4 py-1.5 text-sm font-semibold">{g.day}</p>
          <Table>
            <tbody>
              {g.rows.map((e, i) => (
                <tr key={i}>
                  <Td className="w-1/2"><span className="font-medium">{e.name}</span>{e.notes && <div className="text-xs text-ink-3">{e.notes}</div>}</Td>
                  <Td>{e.sets} × {e.reps}</Td>
                  <Td>{e.weightKg ? `${e.weightKg} kg` : "—"}</Td>
                  <Td className="text-ink-3">{e.restSeconds ? `${e.restSeconds}s rest` : ""}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      ))}
    </div>
  );
}

type Row = { exerciseId: string; dayLabel: string; sets: string; reps: string; weightKg: string; restSeconds: string; notes: string };
const blankRow = (dayLabel = "Day A"): Row => ({ exerciseId: "", dayLabel, sets: "3", reps: "10-12", weightKg: "", restSeconds: "60", notes: "" });

function WorkoutEditor({ memberId, plan, onClose, onSaved }: { memberId: string; plan: WorkoutPlan | null; onClose: () => void; onSaved: () => void }) {
  const { data: lib } = useApi<Exercise[]>("/exercises");
  const [name, setName] = useState(plan?.name ?? "");
  const [goal, setGoal] = useState(plan?.goal ?? "GENERAL");
  const [startDate, setStartDate] = useState(plan?.startDate ?? istToday());
  const [notes, setNotes] = useState(plan?.notes ?? "");
  const [rows, setRows] = useState<Row[]>(plan ? plan.exercises.map((e) => ({ exerciseId: e.exerciseId, dayLabel: e.dayLabel ?? "", sets: String(e.sets), reps: e.reps, weightKg: e.weightKg ? String(e.weightKg) : "", restSeconds: e.restSeconds ? String(e.restSeconds) : "", notes: e.notes ?? "" })) : [blankRow(), blankRow(), blankRow()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const groups = useMemo(() => {
    const m = new Map<string, Exercise[]>();
    for (const e of lib ?? []) m.set(e.muscleGroup, [...(m.get(e.muscleGroup) ?? []), e]);
    return [...m.entries()];
  }, [lib]);
  const set = (i: number, k: keyof Row, v: string) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const move = (i: number, d: -1 | 1) => { const r = [...rows]; const [x] = r.splice(i, 1); r.splice(i + d, 0, x); setRows(r); };

  async function save() {
    setBusy(true); setError(null);
    const body = {
      name, goal, startDate, notes: notes || null, isActive: true,
      exercises: rows.filter((r) => r.exerciseId).map((r) => ({
        exerciseId: r.exerciseId, dayLabel: r.dayLabel || null, sets: Number(r.sets) || 1, reps: r.reps || "10",
        weightKg: r.weightKg ? Number(r.weightKg) : null, restSeconds: r.restSeconds ? Number(r.restSeconds) : null, notes: r.notes || null,
      })),
    };
    try {
      await api(plan ? `/workout-plans/${plan.id}` : `/members/${memberId}/workout-plans`, { method: plan ? "PUT" : "POST", body });
      onSaved();
    } catch (e) { setError(e as ApiError); setBusy(false); }
  }

  const cell = "h-9 w-full rounded border border-line bg-surface px-2 text-sm focus:border-blue focus:outline-none";
  return (
    <Dialog open onClose={onClose} title={plan ? `Edit ${plan.name}` : "New workout plan"} wide>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_170px_160px]">
          <Input label="Plan name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Push / Pull / Legs — 8 weeks" />
          <Select label="Goal" value={goal} onChange={(e) => setGoal(e.target.value)}>{Object.entries(GOAL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
          <Input label="Starts" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr className="text-left text-xs text-ink-3"><th className="pb-1 pr-1 font-medium">Day</th><th className="pb-1 pr-1 font-medium">Exercise</th><th className="pb-1 pr-1 font-medium">Sets</th><th className="pb-1 pr-1 font-medium">Reps</th><th className="pb-1 pr-1 font-medium">kg</th><th className="pb-1 pr-1 font-medium">Rest s</th><th /></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className="w-24 py-1 pr-1"><input aria-label="Day" className={cell} value={r.dayLabel} onChange={(e) => set(i, "dayLabel", e.target.value)} /></td>
                  <td className="py-1 pr-1">
                    <select aria-label="Exercise" className={cell} value={r.exerciseId} onChange={(e) => set(i, "exerciseId", e.target.value)}>
                      <option value="">Choose exercise</option>
                      {groups.map(([g, list]) => <optgroup key={g} label={g}>{list.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</optgroup>)}
                    </select>
                  </td>
                  <td className="w-16 py-1 pr-1"><input aria-label="Sets" inputMode="numeric" className={cell} value={r.sets} onChange={(e) => set(i, "sets", e.target.value)} /></td>
                  <td className="w-20 py-1 pr-1"><input aria-label="Reps" className={cell} value={r.reps} onChange={(e) => set(i, "reps", e.target.value)} /></td>
                  <td className="w-16 py-1 pr-1"><input aria-label="Weight in kg" inputMode="decimal" className={cell} value={r.weightKg} onChange={(e) => set(i, "weightKg", e.target.value)} /></td>
                  <td className="w-16 py-1 pr-1"><input aria-label="Rest in seconds" inputMode="numeric" className={cell} value={r.restSeconds} onChange={(e) => set(i, "restSeconds", e.target.value)} /></td>
                  <td className="w-24 whitespace-nowrap py-1 text-right">
                    <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)} className="rounded px-1.5 text-ink-3 hover:text-ink disabled:opacity-30">↑</button>
                    <button type="button" aria-label="Move down" disabled={i === rows.length - 1} onClick={() => move(i, 1)} className="rounded px-1.5 text-ink-3 hover:text-ink disabled:opacity-30">↓</button>
                    <button type="button" aria-label="Remove" onClick={() => setRows(rows.filter((_, j) => j !== i))} className="rounded px-1.5 text-ink-3 hover:text-red">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Button size="sm" variant="ghost" className="mt-1" onClick={() => setRows([...rows, blankRow(rows.at(-1)?.dayLabel ?? "Day A")])}>Add exercise</Button>
        </div>
        <Textarea label="Notes for the member" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Progression, warm-up, form cues…" />
        <p className="text-xs text-ink-3">Saving makes this the member's current plan. Earlier plans stay in their history.</p>
        <ErrorNote error={error} />
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} busy={busy} disabled={!name || !rows.some((r) => r.exerciseId)}>Save plan</Button>
        </div>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- diet
export function DietSection({ memberId, canWrite }: { memberId: string; canWrite: boolean }) {
  const { data, reload, loading } = useApi<DietPlan[]>(`/members/${memberId}/diet-plans`);
  const [editing, setEditing] = useState<DietPlan | "new" | null>(null);
  const active = data?.find((p) => p.isActive);
  return (
    <Panel title="Diet plan" padded={false}
      actions={canWrite && <div className="flex gap-2">{active && <Button size="sm" variant="secondary" onClick={() => setEditing(active)}>Edit</Button>}<Button size="sm" onClick={() => setEditing("new")}>New plan</Button></div>}>
      {!data && loading ? <Skeleton rows={3} /> : !active ? <Empty title="No current diet plan" /> : (
        <div className="p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <p className="font-cond text-xl font-semibold">{active.name}</p>
              <p className="text-sm text-ink-3">{[active.preferences.map((p) => PREF[p]).join(", "), active.allergies.length ? `avoid ${active.allergies.join(", ")}` : ""].filter(Boolean).join("; ")}</p>
            </div>
            <Link href={`/print/diet/${active.id}`} target="_blank" className="text-sm text-blue hover:underline">Print</Link>
          </div>
          {(active.dailyCalories || active.proteinG) && (
            <p className="mt-3 flex flex-wrap gap-x-5 text-sm">
              {active.dailyCalories && <span><strong className="font-cond text-lg">{active.dailyCalories}</strong> kcal</span>}
              {active.proteinG && <span><strong className="font-cond text-lg">{active.proteinG}</strong> g protein</span>}
              {active.carbsG && <span><strong className="font-cond text-lg">{active.carbsG}</strong> g carbs</span>}
              {active.fatG && <span><strong className="font-cond text-lg">{active.fatG}</strong> g fat</span>}
            </p>
          )}
          <ol className="mt-3 space-y-3">
            {active.meals.map((m, i) => (
              <li key={i} className="grid grid-cols-[64px_1fr] gap-3 text-sm">
                <span className="font-cond text-lg font-semibold text-ink-2">{m.mealTime}</span>
                <span><span className="font-medium">{m.label}:</span> {m.items.map((it) => `${it.food}${it.portion ? ` (${it.portion})` : ""}`).join(", ")}</span>
              </li>
            ))}
          </ol>
          {active.notes && <p className="mt-3 text-sm text-ink-2">{active.notes}</p>}
        </div>
      )}
      {editing && <DietEditor memberId={memberId} plan={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </Panel>
  );
}

/** Meals are typed as one food per line: "Oats with milk, 1 bowl, 450 kcal, 18 g". */
function parseItems(text: string) {
  return text.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    const parts = l.split(",").map((p) => p.trim());
    const item: { food: string; portion?: string; calories?: number; proteinG?: number } = { food: parts[0] };
    for (const p of parts.slice(1)) {
      const kcal = p.match(/^(\d+)\s*kcal$/i);
      const prot = p.match(/^(\d+(?:\.\d+)?)\s*g(?:\s*protein)?$/i);
      if (kcal) item.calories = Number(kcal[1]);
      else if (prot) item.proteinG = Number(prot[1]);
      else item.portion = item.portion ? `${item.portion}, ${p}` : p;
    }
    return item;
  });
}
const itemsText = (items: DietPlan["meals"][number]["items"]) =>
  items.map((it) => [it.food, it.portion, it.calories ? `${it.calories} kcal` : "", it.proteinG ? `${it.proteinG} g` : ""].filter(Boolean).join(", ")).join("\n");

function DietEditor({ memberId, plan, onClose, onSaved }: { memberId: string; plan: DietPlan | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    name: plan?.name ?? "", startDate: plan?.startDate ?? istToday(), dailyCalories: plan?.dailyCalories ? String(plan.dailyCalories) : "",
    proteinG: plan?.proteinG ? String(plan.proteinG) : "", allergies: plan?.allergies.join(", ") ?? "", notes: plan?.notes ?? "",
  });
  const [prefs, setPrefs] = useState<string[]>(plan?.preferences ?? ["VEG"]);
  const [meals, setMeals] = useState(plan ? plan.meals.map((m) => ({ mealTime: m.mealTime, label: m.label, text: itemsText(m.items) })) : [
    { mealTime: "07:30", label: "Breakfast", text: "" }, { mealTime: "13:00", label: "Lunch", text: "" }, { mealTime: "17:00", label: "Snack", text: "" }, { mealTime: "20:30", label: "Dinner", text: "" },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  async function save() {
    setBusy(true); setError(null);
    const body = {
      name: f.name, startDate: f.startDate, dailyCalories: f.dailyCalories ? Number(f.dailyCalories) : null, proteinG: f.proteinG ? Number(f.proteinG) : null,
      preferences: prefs, allergies: f.allergies.split(",").map((a) => a.trim()).filter(Boolean), notes: f.notes || null, isActive: true,
      meals: meals.filter((m) => m.text.trim()).map((m) => ({ mealTime: m.mealTime, label: m.label, items: parseItems(m.text) })),
    };
    try {
      await api(plan ? `/diet-plans/${plan.id}` : `/members/${memberId}/diet-plans`, { method: plan ? "PUT" : "POST", body });
      onSaved();
    } catch (e) { setError(e as ApiError); setBusy(false); }
  }
  return (
    <Dialog open onClose={onClose} title={plan ? `Edit ${plan.name}` : "New diet plan"} wide>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_150px_120px_120px]">
          <Input label="Plan name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Fat loss, vegetarian" />
          <Input label="Starts" type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} />
          <Input label="kcal / day" inputMode="numeric" value={f.dailyCalories} onChange={(e) => setF({ ...f, dailyCalories: e.target.value })} />
          <Input label="Protein g" inputMode="numeric" value={f.proteinG} onChange={(e) => setF({ ...f, proteinG: e.target.value })} />
        </div>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-ink-2">Food preference</legend>
          <div className="flex flex-wrap gap-4">
            {Object.entries(PREF).map(([k, l]) => (
              <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[var(--ink)]" checked={prefs.includes(k)} onChange={(e) => setPrefs(e.target.checked ? [...prefs, k] : prefs.filter((p) => p !== k))} />{l}</label>
            ))}
          </div>
        </fieldset>
        <Input label="Allergies or foods to avoid" value={f.allergies} onChange={(e) => setF({ ...f, allergies: e.target.value })} placeholder="peanuts, lactose" />
        <div className="space-y-3">
          <p className="text-sm text-ink-2">One food per line: <span className="text-ink-3">food, portion, 450 kcal, 18 g</span></p>
          {meals.map((m, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[90px_130px_1fr_auto]">
              <input type="time" aria-label="Meal time" value={m.mealTime} onChange={(e) => setMeals(meals.map((x, j) => (j === i ? { ...x, mealTime: e.target.value } : x)))} className="h-10 rounded-md border border-line bg-surface px-2" />
              <input aria-label="Meal name" value={m.label} onChange={(e) => setMeals(meals.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} className="h-10 rounded-md border border-line bg-surface px-3" />
              <textarea aria-label={`${m.label} foods`} rows={2} value={m.text} onChange={(e) => setMeals(meals.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} className="rounded-md border border-line bg-surface px-3 py-2 text-sm" placeholder="Idli, 3, 200 kcal" />
              <button type="button" aria-label="Remove meal" onClick={() => setMeals(meals.filter((_, j) => j !== i))} className="h-10 rounded px-2 text-ink-3 hover:text-red">✕</button>
            </div>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setMeals([...meals, { mealTime: "16:00", label: "Snack", text: "" }])}>Add meal</Button>
        </div>
        <Textarea label="Notes" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        <ErrorNote error={error} />
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} busy={busy} disabled={!f.name || !meals.some((m) => m.text.trim())}>Save plan</Button>
        </div>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- measurements
export function MetricsSection({ memberId, canWrite }: { memberId: string; canWrite: boolean }) {
  const { data, reload } = useApi<Metric[]>(`/members/${memberId}/body-metrics`);
  const [f, setF] = useState({ measuredOn: istToday(), weightKg: "", bodyFatPct: "", waistCm: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const weights = (data ?? []).filter((m) => m.weightKg != null);
  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api(`/members/${memberId}/body-metrics`, { body: { measuredOn: f.measuredOn, weightKg: f.weightKg ? Number(f.weightKg) : null, bodyFatPct: f.bodyFatPct ? Number(f.bodyFatPct) : null, waistCm: f.waistCm ? Number(f.waistCm) : null } });
      setF({ ...f, weightKg: "", bodyFatPct: "", waistCm: "" });
      reload();
    } catch (err) { setError(err as ApiError); } finally { setBusy(false); }
  }
  const first = weights[0]?.weightKg, last = weights.at(-1)?.weightKg;
  return (
    <Panel title="Measurements" padded={false}
      actions={first != null && last != null && weights.length > 1 && <span className={cx("text-sm font-medium", last - first < 0 ? "text-blue" : "text-ink-2")}>{last - first > 0 ? "+" : ""}{(last - first).toFixed(1)} kg since {fmtDate(weights[0].measuredOn, true)}</span>}>
      {weights.length > 1 && <Sparkline values={weights.map((w) => w.weightKg!)} />}
      {data && data.length > 0 ? (
        <Table>
          <thead><tr><Th>Date</Th><Th className="text-right">Weight</Th><Th className="text-right">Body fat</Th><Th className="text-right">Waist</Th></tr></thead>
          <tbody>
            {[...data].reverse().slice(0, 8).map((m) => (
              <tr key={m.id}>
                <Td>{fmtDate(m.measuredOn)}</Td>
                <Td className="text-right">{m.weightKg != null ? `${m.weightKg} kg` : "—"}</Td>
                <Td className="text-right">{m.bodyFatPct != null ? `${m.bodyFatPct.toFixed(1)}%` : "—"}</Td>
                <Td className="text-right">{m.waistCm != null ? `${m.waistCm} cm` : "—"}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : <Empty title="No measurements yet" />}
      {canWrite && (
        <form onSubmit={add} className="grid grid-cols-3 items-end gap-2 border-t border-line p-4">
          <Input label="Date measured" wrapClass="col-span-3" type="date" value={f.measuredOn} max={istToday()} onChange={(e) => setF({ ...f, measuredOn: e.target.value })} />
          <Input label="Weight kg" inputMode="decimal" value={f.weightKg} onChange={(e) => setF({ ...f, weightKg: e.target.value })} />
          <Input label="Body fat %" inputMode="decimal" value={f.bodyFatPct} onChange={(e) => setF({ ...f, bodyFatPct: e.target.value })} />
          <Input label="Waist cm" inputMode="decimal" value={f.waistCm} onChange={(e) => setF({ ...f, waistCm: e.target.value })} />
          <Button type="submit" className="col-span-3" busy={busy} disabled={!f.weightKg && !f.bodyFatPct && !f.waistCm}>Add measurement</Button>
          {error && <div className="col-span-full"><ErrorNote error={error} /></div>}
        </form>
      )}
    </Panel>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 300},${50 - ((v - min) / span) * 40 - 5}`).join(" ");
  return (
    <svg viewBox="0 0 300 50" className="h-14 w-full px-4 pt-3" preserveAspectRatio="none" role="img" aria-label={`Weight from ${values[0]} to ${values.at(-1)} kg`}>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" className="text-blue" />
    </svg>
  );
}

// ---------------------------------------------------------------- visits
interface Visits { thisMonth: number; last30Days: number; lastVisitAt: string | null; daysSinceLastVisit: number | null; visits: { id: string; branchName: string; method: string; result: string; denyReason: string | null; checkInAt: string; checkOutAt: string | null }[] }
export function VisitsSection({ memberId }: { memberId: string }) {
  const { data } = useApi<Visits>(`/members/${memberId}/attendance`);
  if (!data) return <Panel><Skeleton rows={4} /></Panel>;
  const idle = data.daysSinceLastVisit;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 overflow-hidden rounded-lg border border-line bg-surface">
        <div className="border-r border-line p-4"><p className="text-sm text-ink-2">This month</p><p className="font-cond text-4xl font-semibold">{data.thisMonth}</p></div>
        <div className="border-r border-line p-4"><p className="text-sm text-ink-2">Last 30 days</p><p className="font-cond text-4xl font-semibold">{data.last30Days}</p></div>
        <div className="p-4">
          <p className="text-sm text-ink-2">Last visit</p>
          <p className={cx("font-cond text-4xl font-semibold", idle != null && idle >= 7 && "text-red")}>{idle == null ? "Never" : idle === 0 ? "Today" : `${idle} days ago`}</p>
        </div>
      </div>
      {idle != null && idle >= 7 && <p className="rounded-md border border-red/30 bg-tint-red px-4 py-3 text-sm text-red">Hasn't been in for {idle} days. A quick call or WhatsApp now helps keep them from quitting.</p>}
      <Panel title="Recent visits" padded={false}>
        {data.visits.length === 0 ? <Empty title="No visits yet" /> : (
          <Table>
            <thead><tr><Th>When</Th><Th>Branch</Th><Th>Result</Th><Th>Stayed</Th></tr></thead>
            <tbody>
              {data.visits.map((v) => (
                <tr key={v.id}>
                  <Td>{fmtDateTime(v.checkInAt)}</Td>
                  <Td className="text-ink-2">{v.branchName}</Td>
                  <Td>{v.result === "ALLOWED" ? <span className="text-green">Let in</span> : <span className="text-red">Refused</span>}</Td>
                  <Td className="text-ink-2">{v.checkOutAt ? `${Math.round((Date.parse(v.checkOutAt) - Date.parse(v.checkInAt)) / 60000)} min` : "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------- personal training
interface PtPkg { id: string; packageName: string; trainerId: string; trainerName: string | null; invoiceId: string | null; sessionsTotal: number; sessionsUsed: number; sessionsBooked: number; sessionsLeft: number; validFrom: string; validUntil: string; status: string }
export interface PtSession { id: string; memberPtPackageId: string; memberId: string; memberName: string | null; memberCode: string | null; trainerId: string; trainerName: string | null; scheduledStart: string; scheduledEnd: string; status: string; countsAgainstPackage: boolean; trainerNotes: string | null; packageName: string | null }
interface Catalogue { id: string; name: string; sessionCount: number; validityDays: number; pricePaise: number; status: string }

export const SESSION_STATUS: Record<string, string> = { SCHEDULED: "Booked", COMPLETED: "Done", CANCELLED_BY_MEMBER: "Cancelled by member", CANCELLED_BY_TRAINER: "Cancelled by trainer", NO_SHOW: "No-show" };

export function PtSection({ memberId, memberName, onToast }: { memberId: string; memberName: string; onToast: (m: string) => void }) {
  const { can } = useSession();
  const pkgs = useApi<PtPkg[]>(`/members/${memberId}/pt-packages`);
  const from = useMemo(() => { const d = new Date(); d.setDate(d.getDate() - 60); return d.toISOString().slice(0, 10); }, []);
  const to = useMemo(() => { const d = new Date(); d.setDate(d.getDate() + 60); return d.toISOString().slice(0, 10); }, []);
  const sessions = useApi<{ data: PtSession[] }>(`/pt-sessions?memberId=${memberId}&from=${from}&to=${to}`);
  const [selling, setSelling] = useState(false);
  const [booking, setBooking] = useState<PtPkg | null>(null);
  const refresh = () => { pkgs.reload(); sessions.reload(); };
  const upcoming = (sessions.data?.data ?? []).filter((s) => s.status === "SCHEDULED");
  const past = (sessions.data?.data ?? []).filter((s) => s.status !== "SCHEDULED").reverse();

  return (
    <div className="space-y-6">
      <Panel title="PT packages" padded={false} actions={can("pt.sell") && <Button size="sm" onClick={() => setSelling(true)}>Sell PT package</Button>}>
        {!pkgs.data ? <Skeleton rows={2} /> : pkgs.data.length === 0 ? <Empty title="No personal training yet" /> : (
          <ul>
            {pkgs.data.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-4 border-b border-line px-4 py-4 last:border-0">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{p.packageName} <span className="text-ink-3">with {p.trainerName}</span></p>
                  <p className="text-sm text-ink-3">Valid {fmtDate(p.validFrom, true)} to {fmtDate(p.validUntil)}{p.status === "ACTIVE" && daysUntil(p.validUntil) <= 7 ? `, ends in ${Math.max(0, daysUntil(p.validUntil))} days` : ""}</p>
                  <div className="mt-2 flex h-2 max-w-sm overflow-hidden rounded-full bg-surface-2" aria-hidden>
                    <div className="bg-ink" style={{ width: `${(p.sessionsUsed / p.sessionsTotal) * 100}%` }} />
                    <div className="bg-blue/60" style={{ width: `${(p.sessionsBooked / p.sessionsTotal) * 100}%` }} />
                  </div>
                  <p className="mt-1 text-xs text-ink-2">{p.sessionsUsed} used, {p.sessionsBooked} booked, <strong>{p.sessionsLeft} left to book</strong> of {p.sessionsTotal}</p>
                </div>
                <span className={cx("rounded px-2 py-1 text-xs font-semibold", p.status === "ACTIVE" ? "bg-tint-green text-green" : p.status === "PENDING_PAYMENT" ? "bg-tint-yellow text-yellow" : "bg-surface-2 text-ink-3")}>
                  {p.status === "PENDING_PAYMENT" ? "Awaiting payment" : p.status.charAt(0) + p.status.slice(1).toLowerCase()}
                </span>
                {p.status === "ACTIVE" && p.sessionsLeft > 0 && can("pt.schedule") && <Button size="sm" variant="secondary" onClick={() => setBooking(p)}>Book session</Button>}
                {p.invoiceId && can("invoices.read") && <Link href={`/invoices/${p.invoiceId}`} className="text-sm text-blue hover:underline">Invoice</Link>}
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel title="Sessions" padded={false}>
        {upcoming.length + past.length === 0 ? <Empty title="No sessions booked" /> : (
          <ul>
            {[...upcoming, ...past].map((s) => <SessionRow key={s.id} s={s} onChanged={(m) => { onToast(m); refresh(); }} />)}
          </ul>
        )}
      </Panel>
      {selling && <SellPtDialog memberId={memberId} memberName={memberName} onClose={() => setSelling(false)} onDone={(m) => { setSelling(false); onToast(m); refresh(); }} />}
      {booking && <BookSessionDialog pkg={booking} onClose={() => setBooking(null)} onDone={(m) => { setBooking(null); onToast(m); refresh(); }} />}
    </div>
  );
}

export function SessionRow({ s, onChanged, showMember }: { s: PtSession; onChanged: (msg: string) => void; showMember?: boolean }) {
  const { can, me } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = Date.parse(s.scheduledStart) <= Date.now() + 30 * 60_000;
  const mine = me.staffId === s.trainerId;
  async function act(path: string, body: unknown, msg: string) {
    setBusy(true); setError(null);
    try { const r = await api<{ message?: string }>(`/pt-sessions/${s.id}/${path}`, { body }); onChanged(r.message ?? msg); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const time = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(new Date(s.scheduledStart));
  return (
    <li className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 last:border-0">
      <div className="min-w-0 flex-1">
        <p className="font-medium">{showMember ? <Link href={`/members/${s.memberId}`} className="hover:underline">{s.memberName}</Link> : time}</p>
        <p className="text-sm text-ink-3">{showMember ? `${time}, ${s.packageName ?? ""}` : `with ${s.trainerName}`}{s.trainerNotes ? `. ${s.trainerNotes}` : ""}</p>
        {error && <p className="text-sm text-red">{error}</p>}
      </div>
      <span className={cx("text-sm font-medium", s.status === "COMPLETED" ? "text-green" : s.status === "SCHEDULED" ? "text-blue" : s.countsAgainstPackage ? "text-red" : "text-ink-3")}>
        {SESSION_STATUS[s.status]}{s.status !== "SCHEDULED" && s.status !== "COMPLETED" ? (s.countsAgainstPackage ? ", counted" : ", not counted") : ""}
      </span>
      {s.status === "SCHEDULED" && (
        <div className="flex gap-1">
          {started && can("pt.complete") && (mine || can("pt.read")) && <Button size="sm" busy={busy} onClick={() => act("complete", {}, "Session marked done")}>Done</Button>}
          {started && can("pt.schedule") && <Button size="sm" variant="ghost" disabled={busy} onClick={() => act("cancel", { by: "MEMBER", noShow: true }, "Marked as no-show")}>No-show</Button>}
          {!started && can("pt.schedule") && (
            <>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => act("cancel", { by: "MEMBER" }, "Cancelled")}>Member cancelled</Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => act("cancel", { by: "TRAINER" }, "Cancelled, session returned to the package")}>Trainer cancelled</Button>
            </>
          )}
        </div>
      )}
    </li>
  );
}

function SellPtDialog({ memberId, memberName, onClose, onDone }: { memberId: string; memberName: string; onClose: () => void; onDone: (m: string) => void }) {
  const { can } = useSession();
  const { data: cat } = useApi<Catalogue[]>("/pt-packages?status=ACTIVE");
  const { data: trainers } = useApi<Trainer[]>("/trainers");
  const [ptPackageId, setPkg] = useState("");
  const [trainerId, setTrainer] = useState("");
  const [discount, setDiscount] = useState("");
  const [method, setMethod] = useState("UPI");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [quote, setQuote] = useState<{ totalPaise: number; subtotalPaise: number; cgstPaise: number; sgstPaise: number; validUntil: string } | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const key = useMemo(() => newKey(), [ptPackageId, trainerId, discount, method, amount, reference]);
  useEffect(() => { if (cat && !ptPackageId) setPkg(cat.find((c) => c.sessionCount >= 10)?.id ?? cat[0]?.id ?? ""); }, [cat, ptPackageId]);
  useEffect(() => { if (trainers && !trainerId) setTrainer(trainers[0]?.id ?? ""); }, [trainers, trainerId]);
  useEffect(() => {
    if (!ptPackageId || !trainerId) return;
    api<typeof quote>(`/members/${memberId}/pt-packages/quote`, { body: { ptPackageId, trainerId, discountPaise: discount ? toPaise(discount) : undefined } })
      .then((q) => { setQuote(q); setAmount(String(q!.totalPaise / 100)); setError(null); }).catch((e) => { setQuote(null); setError(e); });
  }, [memberId, ptPackageId, trainerId, discount]);
  async function sell() {
    setBusy(true); setError(null);
    try {
      const r = await api<{ ptPackage: { status: string }; invoice: { invoiceNumber: string } }>(`/members/${memberId}/pt-packages`, {
        idempotencyKey: key,
        body: { ptPackageId, trainerId, discountPaise: discount ? toPaise(discount) : undefined, payment: amount && can("payments.collect") ? { method, amountPaise: toPaise(amount), referenceNumber: reference || undefined } : undefined },
      });
      onDone(r.ptPackage.status === "ACTIVE" ? `PT package sold. Invoice ${r.invoice.invoiceNumber}.` : `Invoice ${r.invoice.invoiceNumber} issued. Sessions can be booked once it's paid.`);
    } catch (e) { setError(e as ApiError); setBusy(false); }
  }
  return (
    <Dialog open onClose={onClose} title={`Sell personal training to ${memberName}`} wide>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Package" value={ptPackageId} onChange={(e) => setPkg(e.target.value)}>
            {cat?.map((c) => <option key={c.id} value={c.id}>{c.name} — {rupees(c.pricePaise)} + GST, {c.validityDays} days</option>)}
          </Select>
          <Select label="Trainer" value={trainerId} onChange={(e) => setTrainer(e.target.value)}>
            {trainers?.map((t) => <option key={t.id} value={t.id}>{t.displayName} ({t.branchName})</option>)}
          </Select>
          <MoneyInput label="Discount" value={discount} onChange={(e) => setDiscount(e.target.value)} hint="Up to 10% unless you can give bigger discounts." />
        </div>
        {quote && (
          <dl className="space-y-1 rounded-lg border border-line p-4 text-sm">
            <div className="flex justify-between"><dt className="text-ink-2">Package</dt><dd>{rupees(quote.subtotalPaise, true)}</dd></div>
            <div className="flex justify-between"><dt className="text-ink-2">CGST + SGST 18%</dt><dd>{rupees(quote.cgstPaise + quote.sgstPaise, true)}</dd></div>
            <div className="flex items-baseline justify-between border-t border-line pt-2"><dt className="font-medium">Total, valid until {fmtDate(quote.validUntil)}</dt><dd className="font-cond text-2xl font-semibold">{rupees(quote.totalPaise)}</dd></div>
          </dl>
        )}
        {can("payments.collect") && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Select label="Paid by" value={method} onChange={(e) => setMethod(e.target.value)}><option value="UPI">UPI</option><option value="CASH">Cash</option><option value="CARD">Card</option><option value="BANK_TRANSFER">Bank transfer</option></Select>
            <MoneyInput label="Amount received" value={amount} onChange={(e) => setAmount(e.target.value)} hint="Empty = invoice only" />
            {method !== "CASH" && amount && <Input label="Reference number" value={reference} onChange={(e) => setReference(e.target.value)} />}
          </div>
        )}
        <ErrorNote error={error} />
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={sell} busy={busy} disabled={!quote}>{amount ? `Sell and record ${rupees(toPaise(amount), true)}` : "Sell and issue invoice"}</Button>
        </div>
      </div>
    </Dialog>
  );
}

export function BookSessionDialog({ pkg, onClose, onDone }: { pkg: { id: string; packageName: string; trainerName: string | null; sessionsLeft: number; validUntil: string }; onClose: () => void; onDone: (m: string) => void }) {
  const tomorrow = useMemo(() => { const d = new Date(); d.setDate(d.getDate() + 1); return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d); }, []);
  const [date, setDate] = useState(tomorrow);
  const [time, setTime] = useState("07:00");
  const [duration, setDuration] = useState("60");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  async function book() {
    setBusy(true); setError(null);
    try {
      await api("/pt-sessions", { body: { memberPtPackageId: pkg.id, scheduledStart: new Date(`${date}T${time}:00+05:30`).toISOString(), durationMinutes: Number(duration) } });
      onDone(`Booked ${fmtDate(date, true)} at ${time} with ${pkg.trainerName}`);
    } catch (e) { setError(e as ApiError); setBusy(false); }
  }
  return (
    <Dialog open onClose={onClose} title={`Book a session with ${pkg.trainerName}`}>
      <div className="space-y-4">
        <p className="text-sm text-ink-2">{pkg.packageName}: {pkg.sessionsLeft} left to book, valid until {fmtDate(pkg.validUntil)}.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Input label="Date" type="date" value={date} min={istToday()} max={pkg.validUntil} onChange={(e) => setDate(e.target.value)} />
          <Input label="Time" type="time" value={time} step={900} onChange={(e) => setTime(e.target.value)} />
          <Select label="Length" value={duration} onChange={(e) => setDuration(e.target.value)}><option value="30">30 min</option><option value="45">45 min</option><option value="60">1 hour</option><option value="90">1.5 hours</option></Select>
        </div>
        <ErrorNote error={error} />
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={book} busy={busy}>Book session</Button>
        </div>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- freeze
export interface FreezeInfo { allowed: boolean; maxDays: number; maxCount: number; daysUsed: number; timesUsed: number; daysLeft: number; timesLeft: number }
export function FreezeDialog({ subscriptionId, endDate, freeze, onClose, onDone }: { subscriptionId: string; endDate: string; freeze: FreezeInfo; onClose: () => void; onDone: (m: string) => void }) {
  const today = istToday();
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(() => { const d = new Date(today + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + Math.min(6, freeze.daysLeft - 1)); return d.toISOString().slice(0, 10); });
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const days = Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1);
  const newEnd = (() => { const d = new Date(endDate + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); })();
  async function submit() {
    setBusy(true); setError(null);
    try {
      await api(`/subscriptions/${subscriptionId}/freeze`, { body: { startDate: start, endDate: end, reason: reason || undefined } });
      onDone(`Frozen for ${days} days. Membership now ends ${fmtDate(newEnd)}.`);
    } catch (e) { setError(e as ApiError); setBusy(false); }
  }
  return (
    <Dialog open onClose={onClose} title="Freeze membership">
      <div className="space-y-4">
        <p className="text-sm text-ink-2">This plan allows {freeze.maxDays} days in {freeze.maxCount} freeze{freeze.maxCount > 1 ? "s" : ""}. <strong>{freeze.daysLeft} days</strong> and <strong>{freeze.timesLeft}</strong> freeze{freeze.timesLeft === 1 ? "" : "s"} left.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="From" type="date" value={start} min={today} onChange={(e) => setStart(e.target.value)} />
          <Input label="Until (inclusive)" type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
        </div>
        <Input label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Travel, injury, exams…" />
        <p className={cx("rounded-md px-3 py-2 text-sm", days > freeze.daysLeft ? "bg-tint-red text-red" : "bg-surface-2")}>
          {days > freeze.daysLeft ? `That's ${days} days, more than the ${freeze.daysLeft} left.` : `${days} day${days === 1 ? "" : "s"}. The member can't check in during the freeze, and the membership will end on ${fmtDate(newEnd)} instead of ${fmtDate(endDate)}.`}
        </p>
        <ErrorNote error={error} />
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} busy={busy} disabled={days < 1 || days > freeze.daysLeft}>Freeze {days} day{days === 1 ? "" : "s"}</Button>
        </div>
      </div>
    </Dialog>
  );
}
