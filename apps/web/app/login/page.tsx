"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Button, ErrorNote, Input } from "@/components/ui";
import { useBrand } from "@/lib/brand";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/auth/login", { body: { identifier, password } });
      const next = params.get("next");
      // Only same-site relative paths, so the link can't bounce users elsewhere.
      router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
    } catch (err) {
      setError(err as ApiError);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <Input label="Email or mobile number" autoComplete="username" required value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoFocus />
      <Input label="Password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      <ErrorNote error={error} />
      <Button type="submit" busy={busy} className="mt-1 h-11">Sign in</Button>
    </form>
  );
}

export default function LoginPage() {
  const brand = useBrand();
  const where = brand?.branches?.map((b) => b.name).join(" and ");
  return (
    <main className="grid min-h-screen lg:grid-cols-[1fr_minmax(420px,40%)]">
      <div className="relative hidden overflow-hidden bg-rail lg:block" aria-hidden>
        <Plates />
        <div className="absolute bottom-10 left-10 max-w-md">
          <p className="font-cond text-5xl font-semibold leading-none text-white">{brand?.brandName ?? "\u00a0"}</p>
          <p className="mt-3 text-lg text-rail-ink">Front desk, memberships and leads{where ? ` for ${where}` : ""}.</p>
        </div>
      </div>
      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <p className="mb-6 font-cond text-2xl font-semibold lg:hidden">{brand?.brandName}</p>
          <h1 className="text-4xl">Staff sign in</h1>
          <p className="mb-8 mt-2 text-ink-2">Use the email or mobile number your gym registered for you.</p>
          <Suspense><LoginForm /></Suspense>
          <p className="mt-6 text-sm text-ink-3">Forgot your password? Ask the owner or branch manager to reset it.</p>
          <p className="mt-8 border-t border-line pt-6 text-sm text-ink-2">Gym member? <a href="/m" className="font-semibold text-blue hover:underline">Open the member app</a> and sign in with your mobile number.</p>
        </div>
      </div>
    </main>
  );
}

/** Stack of bumper plates seen edge-on — the brand's one illustration. */
function Plates() {
  const plates = [
    { c: "#c22a32", w: 34, h: 420 }, { c: "#2556c4", w: 30, h: 420 }, { c: "#e0a400", w: 26, h: 380 },
    { c: "#1e7d4f", w: 22, h: 340 }, { c: "#e8edf2", w: 12, h: 220 },
  ];
  let x = 0;
  return (
    <svg className="absolute right-[-60px] top-1/2 h-[560px] -translate-y-1/2 opacity-90" viewBox="0 0 420 560">
      <rect x="0" y="268" width="420" height="24" rx="4" fill="#3a4554" />
      {plates.map((p, i) => {
        const el = <rect key={i} x={60 + x} y={280 - p.h / 2} width={p.w} height={p.h} rx="6" fill={p.c} />;
        x += p.w + 4;
        return el;
      })}
      <rect x={60 + x + 8} y="250" width="26" height="60" rx="4" fill="#8592a3" />
    </svg>
  );
}
