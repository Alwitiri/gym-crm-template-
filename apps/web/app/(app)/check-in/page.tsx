"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, cx, ErrorNote, Select } from "@/components/ui";
import { api, ApiError, fmtDate, fmtDateTime, newKey, rupees } from "@/lib/api";
import { useApi, useSession } from "@/lib/session";

interface Decision {
  attendanceId?: string;
  result: "ALLOWED" | "DENIED" | "CHOOSE";
  denyReason?: string;
  alreadyInside?: boolean;
  message: string;
  member?: { memberId: string; memberCode: string; firstName: string; fullName: string; homeBranch: string; planName: string | null; validUntil: string | null; daysRemaining: number | null; duesPaise: number };
  candidates?: { memberCode: string; name: string; branch: string }[];
}
interface Visit { id: string; memberId: string | null; memberName: string | null; memberCode: string | null; checkInAt: string; result: string; denyReason: string | null }
interface Log { summary: { checkIns: number; denied: number; insideNow: number }; data: Visit[] }

/** How long a result stays on screen before the kiosk is ready for the next person. */
const RESULT_MS = 6000;

export default function CheckInPage() {
  const { branches, branchId, setBranchId, can } = useSession();
  const [credential, setCredential] = useState("");
  const [decision, setDecision] = useState<Decision | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [camera, setCamera] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const effectiveBranch = branchId || (branches.length === 1 ? branches[0].id : "");
  const inside = useApi<Log>(effectiveBranch ? `/attendance?inside=true&pageSize=100&branchId=${effectiveBranch}` : null);

  const reset = useCallback(() => {
    setDecision(null);
    setCredential("");
    input.current?.focus();
  }, []);

  const submit = useCallback(async (value: string) => {
    const c = value.trim();
    if (!c || busy || !effectiveBranch) return;
    setBusy(true);
    setError(null);
    clearTimeout(clearTimer.current);
    try {
      const d = await api<Decision>("/attendance/check-in", { body: { credential: c, branchId: effectiveBranch }, idempotencyKey: newKey() });
      setDecision(d);
      setCredential("");
      if (d.result !== "CHOOSE") clearTimer.current = setTimeout(reset, RESULT_MS);
      inside.reload();
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
      input.current?.focus();
    }
  }, [busy, effectiveBranch, reset, inside]);

  // Keep focus on the input so a USB scanner always types into it.
  useEffect(() => {
    const keep = () => { if (document.activeElement === document.body) input.current?.focus(); };
    const t = setInterval(keep, 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => () => clearTimeout(clearTimer.current), []);

  async function checkOut(id: string) {
    await api(`/attendance/${id}/check-out`, { method: "POST" }).catch(() => undefined);
    inside.reload();
  }

  if (!effectiveBranch) {
    return (
      <div className="mx-auto max-w-md py-16">
        <h1 className="text-3xl">Check-in</h1>
        <p className="mb-4 mt-2 text-ink-2">Which branch is this desk at?</p>
        <Select label="Branch" value="" onChange={(e) => setBranchId(e.target.value)}>
          <option value="" disabled>Choose a branch</option>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </Select>
      </div>
    );
  }

  const tone = !decision ? "idle" : decision.result === "CHOOSE" ? "choose" : decision.result === "DENIED" ? "denied" : decision.alreadyInside ? "inside" : "allowed";
  const panel = {
    idle: "border-line bg-surface",
    allowed: "border-green bg-tint-green",
    inside: "border-blue bg-tint-blue",
    denied: "border-red bg-tint-red",
    choose: "border-yellow bg-tint-yellow",
  }[tone];

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl">Check-in</h1>
            <p className="text-ink-2">{branches.find((b) => b.id === effectiveBranch)?.name}. Scan a membership card, or type a phone number or member code.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setCamera((c) => !c)}>{camera ? "Stop camera" : "Use camera"}</Button>
            <Button variant="ghost" onClick={() => document.documentElement.requestFullscreen?.().catch(() => undefined)}>Full screen</Button>
          </div>
        </div>

        <form onSubmit={(e) => { e.preventDefault(); void submit(credential); }} className="flex gap-2">
          <label htmlFor="credential" className="sr-only">Card, phone number or member code</label>
          <input
            id="credential" ref={input} autoFocus autoComplete="off" spellCheck={false} value={credential}
            onChange={(e) => setCredential(e.target.value)}
            placeholder="Scan card, or type 98765 43210 / CBE-RSP-001024"
            className="h-16 flex-1 rounded-lg border-2 border-line bg-surface px-5 font-cond text-2xl placeholder:font-sans placeholder:text-base placeholder:text-ink-3 focus:border-ink focus:outline-none"
          />
          <Button type="submit" busy={busy} className="h-16 px-8 text-lg">Check in</Button>
        </form>
        <ErrorNote error={error} />

        {camera && <CameraScanner onCode={(c) => void submit(c)} paused={!!decision} />}

        <section aria-live="assertive" className={cx("relative min-h-72 overflow-hidden rounded-xl border-2 p-8 transition-colors", panel)}>
          {!decision && (
            <div className="flex h-56 flex-col items-center justify-center text-center text-ink-3">
              <p className="font-cond text-3xl">Ready</p>
              <p className="mt-1">Waiting for the next member</p>
            </div>
          )}
          {decision && decision.result === "CHOOSE" && (
            <div>
              <p className="font-cond text-3xl font-semibold">{decision.message}</p>
              <div className="mt-5 grid gap-2 sm:grid-cols-2">
                {decision.candidates!.map((c) => (
                  <button key={c.memberCode} onClick={() => void submit(c.memberCode)} className="rounded-lg border border-line bg-surface p-4 text-left hover:border-ink">
                    <span className="block text-lg font-medium">{c.name}</span>
                    <span className="text-sm text-ink-3">{c.memberCode}, {c.branch}</span>
                  </button>
                ))}
              </div>
              <Button variant="ghost" className="mt-4" onClick={reset}>Cancel</Button>
            </div>
          )}
          {decision && decision.result !== "CHOOSE" && (
            <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
              <div>
                <p className={cx("font-cond text-xl font-semibold", tone === "denied" ? "text-red" : tone === "inside" ? "text-blue" : "text-green")}>
                  {tone === "denied" ? "Not allowed" : tone === "inside" ? "Already in" : "Allowed"}
                </p>
                <p className="mt-1 font-cond text-6xl font-bold leading-none">{decision.member?.fullName ?? "Unknown card"}</p>
                <p className="mt-3 max-w-xl text-lg">{decision.message}</p>
                {decision.denyReason === "OUTSIDE_ACCESS_HOURS" && can("branches.manage") && <Link href="/branches" className="mt-1 inline-block text-sm text-blue hover:underline">Change opening hours</Link>}
                {decision.member && (
                  <p className="mt-2 text-ink-2">
                    {decision.member.memberCode}
                    {decision.member.planName && <>, {decision.member.planName}{decision.member.validUntil && ` until ${fmtDate(decision.member.validUntil)}`}</>}
                  </p>
                )}
              </div>
              <div className="flex flex-col items-start gap-3 md:items-end">
                {decision.member?.daysRemaining != null && decision.result === "ALLOWED" && (
                  <p className={cx("font-cond text-7xl font-bold leading-none", decision.member.daysRemaining <= 5 ? "text-yellow" : "text-green")}>
                    {decision.member.daysRemaining}<span className="ml-2 text-2xl font-medium text-ink-2">days left</span>
                  </p>
                )}
                {!!decision.member?.duesPaise && <p className="rounded-md bg-surface px-3 py-1.5 font-medium text-red">Owes {rupees(decision.member.duesPaise)}</p>}
                <div className="flex gap-2">
                  {decision.member && <Link href={`/members/${decision.member.memberId}`} className="inline-flex h-10 items-center rounded-md border border-line bg-surface px-4 font-medium hover:bg-surface-2">Open profile</Link>}
                  {decision.result === "DENIED" && decision.attendanceId && decision.member && can("attendance.override") && <OverrideButton id={decision.attendanceId} onDone={(d) => { setDecision(d); inside.reload(); }} />}
                  <Button variant="secondary" onClick={reset}>Next</Button>
                </div>
              </div>
            </div>
          )}
          {decision && decision.result !== "CHOOSE" && <span className="absolute bottom-0 left-0 h-1 animate-[shrink_6s_linear_forwards] bg-ink/30" style={{ width: "100%" }} aria-hidden />}
        </section>
      </div>

      <aside className="rounded-lg border border-line bg-surface">
        <header className="flex items-baseline justify-between border-b border-line px-4 py-3">
          <h2 className="text-lg">In the gym now</h2>
          <span className="font-cond text-2xl font-semibold">{inside.data?.summary.insideNow ?? "—"}</span>
        </header>
        <p className="border-b border-line px-4 py-2 text-sm text-ink-3">{inside.data ? `${inside.data.summary.checkIns} check-ins today, ${inside.data.summary.denied} refused` : ""}</p>
        <ul className="max-h-[60vh] overflow-y-auto">
          {inside.data?.data.length === 0 && <li className="px-4 py-6 text-center text-sm text-ink-3">Nobody checked in right now.</li>}
          {inside.data?.data.map((v) => (
            <li key={v.id} className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5 last:border-0">
              <span className="min-w-0">
                <span className="block truncate font-medium">{v.memberName}</span>
                <span className="text-xs text-ink-3">since {fmtDateTime(v.checkInAt)}</span>
              </span>
              <Button size="sm" variant="ghost" onClick={() => checkOut(v.id)}>Check out</Button>
            </li>
          ))}
        </ul>
      </aside>
      <style>{`@keyframes shrink { from { width: 100% } to { width: 0 } }`}</style>
    </div>
  );
}

function OverrideButton({ id, onDone }: { id: string; onDone: (d: Decision) => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  if (!open) return <Button variant="danger" onClick={() => setOpen(true)}>Let in anyway</Button>;
  return (
    <form className="flex gap-2" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      try {
        await api(`/attendance/${id}/override`, { body: { reason } });
        onDone({ result: "ALLOWED", message: `Let in by manager: ${reason}` });
      } finally { setBusy(false); }
    }}>
      <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (min 5 letters)" aria-label="Reason"
        className="h-10 w-56 rounded-md border border-line bg-surface px-3 focus:border-blue focus:outline-none" />
      <Button type="submit" busy={busy} disabled={reason.trim().length < 5}>Confirm</Button>
    </form>
  );
}

/** Reads QR codes from the device camera (works in Chrome and Edge on tablets and laptops). */
function CameraScanner({ onCode, paused }: { onCode: (c: string) => void; paused: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const last = useRef<{ code: string; at: number }>({ code: "", at: 0 });
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode; // keep the camera running across re-renders

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 } } });
        if (!video.current || stopped) return;
        video.current.srcObject = stream;
        await video.current.play();
        const jsQR = (await import("jsqr")).default;
        const tick = () => {
          if (stopped) return;
          const v = video.current, c = canvas.current;
          if (v && c && v.readyState >= 2 && !pausedRef.current) {
            const w = 480, h = Math.round((v.videoHeight / v.videoWidth) * 480) || 360;
            c.width = w; c.height = h;
            const ctx = c.getContext("2d", { willReadFrequently: true })!;
            ctx.drawImage(v, 0, 0, w, h);
            const img = ctx.getImageData(0, 0, w, h);
            const found = jsQR(img.data, w, h, { inversionAttempts: "dontInvert" });
            const now = Date.now();
            if (found?.data && !(found.data === last.current.code && now - last.current.at < 8000)) {
              last.current = { code: found.data, at: now };
              onCodeRef.current(found.data);
            }
          }
          raf = window.setTimeout(tick, 200) as unknown as number;
        };
        tick();
      } catch {
        setError("The camera isn't available. Allow camera access for this site, or use a USB scanner.");
      }
    })();
    return () => { stopped = true; clearTimeout(raf); stream?.getTracks().forEach((t) => t.stop()); };
  }, []);

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-black">
      {error ? <p className="bg-surface p-4 text-sm text-red">{error}</p> : (
        <div className="relative mx-auto aspect-video max-h-72">
          <video ref={video} muted playsInline className="h-full w-full object-cover" />
          <span className="pointer-events-none absolute inset-[18%] rounded-lg border-2 border-white/70" aria-hidden />
        </div>
      )}
      <canvas ref={canvas} className="hidden" />
    </div>
  );
}
