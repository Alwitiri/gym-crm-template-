"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Button, ErrorNote, Input, Select, Textarea } from "@/components/ui";
import { api, ApiError, rupees } from "@/lib/api";

interface Info { brandName: string; branches: { id: string; name: string; city: string; addressLine1: string }[]; plans: { id: string; name: string; durationDays: number; pricePaise: number }[] }
const SOURCES = ["WEBSITE", "INSTAGRAM", "FACEBOOK", "GOOGLE_ADS", "WHATSAPP", "OTHER"];

/** Public enquiry form. Link it from the website, Instagram bio or Google profile: /join?src=instagram&c=diwali */
function JoinForm() {
  const params = useSearchParams();
  const [info, setInfo] = useState<Info | null>(null);
  const [f, setF] = useState({ name: "", phone: "", email: "", branchId: "", planId: "", goal: "", company: "" });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  useEffect(() => { api<Info>("/public/join").then((i) => { setInfo(i); setF((x) => ({ ...x, branchId: i.branches[0]?.id ?? "" })); }).catch(setErr); }, []);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const srcParam = (params.get("src") ?? "").toUpperCase().replace(/[^A-Z_]/g, "");
  const source = SOURCES.includes(srcParam) ? srcParam : srcParam === "IG" ? "INSTAGRAM" : srcParam === "FB" ? "FACEBOOK" : srcParam === "GOOGLE" ? "GOOGLE_ADS" : "WEBSITE";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      await api("/public/enquiries", { body: { ...f, planId: f.planId || undefined, email: f.email || undefined, goal: f.goal || undefined, source, campaign: params.get("c")?.slice(0, 80) || undefined } });
      setDone(true);
    } catch (e) { setErr(e as ApiError); } finally { setBusy(false); }
  }
  const fe = err?.fieldErrors() ?? {};

  return (
    <main className="min-h-screen bg-chalk">
      <div className="bg-rail px-6 pb-14 pt-10 text-white">
        <div className="mx-auto max-w-lg">
          <p className="font-cond text-3xl font-semibold">{info?.brandName ?? " "}</p>
          <h1 className="mt-6 text-4xl text-white">Start training with us</h1>
          <p className="mt-2 text-lg text-rail-ink">Leave your number and we'll call you to book a free trial session.</p>
        </div>
      </div>
      <div className="mx-auto -mt-8 max-w-lg px-4 pb-16">
        <div className="rounded-xl border border-line bg-surface p-6 shadow-sm">
          {done ? (
            <div className="py-6 text-center">
              <p className="text-2xl font-semibold">Thanks, {f.name.split(" ")[0]}!</p>
              <p className="mt-2 text-ink-2">We'll call you on {f.phone} soon, usually within a working day.</p>
            </div>
          ) : (
            <form onSubmit={submit} className="flex flex-col gap-4">
              <Input label="Your name" autoComplete="name" value={f.name} onChange={(e) => set("name", e.target.value)} required error={fe.name} />
              <Input label="Mobile number" inputMode="tel" autoComplete="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} required error={fe.phone} />
              <Input label="Email (optional)" type="email" autoComplete="email" value={f.email} onChange={(e) => set("email", e.target.value)} error={fe.email} />
              {info && info.branches.length > 1 && (
                <Select label="Nearest branch" value={f.branchId} onChange={(e) => set("branchId", e.target.value)}>
                  {info.branches.map((b) => <option key={b.id} value={b.id}>{b.name}, {b.city}</option>)}
                </Select>
              )}
              {info && info.plans.length > 0 && (
                <Select label="Interested in (optional)" value={f.planId} onChange={(e) => set("planId", e.target.value)}>
                  <option value="">Not sure yet</option>
                  {info.plans.map((p) => <option key={p.id} value={p.id}>{p.name} · {rupees(p.pricePaise)} + GST</option>)}
                </Select>
              )}
              <Textarea label="Your goal (optional)" placeholder="Lose weight, build strength, get back in shape…" value={f.goal} onChange={(e) => set("goal", e.target.value)} maxLength={300} />
              {/* Hidden from people; bots fill it in. */}
              <input type="text" name="company" tabIndex={-1} autoComplete="off" value={f.company} onChange={(e) => set("company", e.target.value)} className="absolute left-[-9999px] h-0 w-0 opacity-0" aria-hidden />
              <ErrorNote error={err} />
              <Button type="submit" busy={busy} className="h-12">Request a call back</Button>
              <p className="text-xs text-ink-3">We'll only use your number to contact you about joining.</p>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}

export default function JoinPage() {
  return <Suspense><JoinForm /></Suspense>;
}
