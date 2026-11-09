"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useBrand } from "@/lib/brand";
import { cx, Status } from "./ui";

const NAV = [
  { href: "/", label: "Dashboard", perm: "dashboard.read", icon: "M3 12l9-8 9 8M5 10v10h14V10" },
  { href: "/check-in", label: "Check-in", perm: "attendance.checkin", icon: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2M18 14h2v2M14 18h2v2M18 18h2v2" },
  { href: "/members", label: "Members", perm: ["members.read", "members.read.assigned"], icon: "M16 19v-1a4 4 0 00-4-4H6a4 4 0 00-4 4v1M9 10a3 3 0 100-6 3 3 0 000 6M22 19v-1a4 4 0 00-3-3.87M16 4.13a3 3 0 010 5.74" },
  { href: "/attendance", label: "Attendance", perm: ["attendance.read", "attendance.read.assigned"], icon: "M8 2v4M16 2v4M3 9h18M5 5h14v16H5zM9 15l2 2 4-4" },
  { href: "/schedule", label: "PT schedule", perm: ["pt.read", "pt.read.assigned"], icon: "M12 7v5l3 2M12 3a9 9 0 100 18 9 9 0 000-18z" },
  { href: "/trainers", label: "Trainers", perm: "trainers.read", icon: "M6 12h12M3 9v6M21 9v6M6 7v10M18 7v10" },
  { href: "/leads", label: "Leads", perm: ["leads.read", "leads.read.assigned"], icon: "M3 5h18l-7 8v6l-4 2v-8z" },
  { href: "/payments", label: "Collections", perm: "payments.read", icon: "M2 7h20v10H2zM2 11h20M6 15h3" },
  { href: "/plans", label: "Plans", perm: "plans.read", icon: "M4 4h16v16H4zM4 9h16M9 4v16" },
  { href: "/messages", label: "Messages", perm: "notifications.read", icon: "M21 12a8 8 0 01-11.6 7.1L3 21l1.9-6.4A8 8 0 1121 12z" },
  { href: "/expenses", label: "Expenses", perm: "expenses.read", icon: "M12 2v20M17 6H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" },
  { href: "/reports", label: "Reports", perm: ["reports.finance", "reports.read"], icon: "M4 20V10M10 20V4M16 20v-7M22 20H2" },
  { href: "/staff", label: "Staff", perm: "staff.read", icon: "M12 12a4 4 0 100-8 4 4 0 000 8M4 21v-1a6 6 0 0112 0v1M19 8v6M22 11h-6" },
  { href: "/branches", label: "Branches", perm: "branches.manage", icon: "M3 21h18M5 21V8l7-5 7 5v13M9 21v-6h6v6" },
  { href: "/settings", label: "Settings", perm: ["settings.read", "settings.manage"], icon: "M12 15a3 3 0 100-6 3 3 0 000 6M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" },
] as const;

export function Shell({ children }: { children: React.ReactNode }) {
  const { me, can } = useSession();
  const brand = useBrand();
  const path = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => setMenuOpen(false), [path]);

  const items = NAV.filter((n) => (Array.isArray(n.perm) ? n.perm.some(can) : can(n.perm as string)));

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[232px_1fr]">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2">Skip to content</a>
      <aside className={cx("fixed inset-y-0 left-0 z-40 flex w-[232px] flex-col bg-rail text-rail-ink transition-transform lg:static lg:translate-x-0", menuOpen ? "translate-x-0" : "-translate-x-full")}>
        <div className="flex h-16 items-center gap-2.5 px-5">
          <PlateMark />
          <span className="truncate font-cond text-xl font-semibold text-white">{brand?.brandName ?? "\u00a0"}</span>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-2" aria-label="Main">
          {items.map((n) => {
            const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
            return (
              <Link key={n.href} href={n.href} aria-current={active ? "page" : undefined}
                className={cx("mb-0.5 flex h-10 items-center gap-3 rounded-md px-3 font-medium", active ? "bg-white/10 text-white" : "hover:bg-white/5 hover:text-white")}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={n.icon} /></svg>
                {n.label}
              </Link>
            );
          })}
        </nav>
        <UserBox name={me.displayName} />
      </aside>
      {menuOpen && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setMenuOpen(false)} aria-hidden />}

      <div className="min-w-0">
        <header className="no-print sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-chalk/95 px-4 backdrop-blur lg:px-8">
          <button className="rounded p-2 text-ink-2 hover:bg-surface-2 lg:hidden" onClick={() => setMenuOpen(true)} aria-label="Open menu">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </button>
          {(can("members.read") || can("members.read.assigned")) && <MemberSearch />}
          <div className="ml-auto flex items-center gap-2">
            <BranchSwitcher />
            <ThemeToggle />
          </div>
        </header>
        <main id="main" className="mx-auto max-w-[1280px] px-4 py-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}

function PlateMark() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden>
      <circle cx="13" cy="13" r="12" fill="#c22a32" />
      <circle cx="13" cy="13" r="7" fill="none" stroke="#11151b" strokeWidth="1.5" opacity=".5" />
      <circle cx="13" cy="13" r="3" fill="#11151b" />
    </svg>
  );
}

function UserBox({ name }: { name: string }) {
  const router = useRouter();
  async function logout() {
    await api("/auth/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/login");
  }
  return (
    <div className="border-t border-white/10 p-3">
      <div className="flex items-center gap-3 px-2 py-1.5">
        <span className="grid size-8 place-items-center rounded-full bg-white/10 font-cond font-semibold text-white">{name.split(" ").map((p) => p[0]).slice(0, 2).join("")}</span>
        <span className="min-w-0 flex-1 truncate text-sm text-white">{name}</span>
      </div>
      <Link href="/account" className="mt-1 flex h-9 w-full items-center rounded-md px-3 text-left text-sm hover:bg-white/5 hover:text-white">My account</Link>
      <button onClick={logout} className="h-9 w-full rounded-md px-3 text-left text-sm hover:bg-white/5 hover:text-white">Sign out</button>
    </div>
  );
}

function BranchSwitcher() {
  const { branches, branchId, setBranchId, me } = useSession();
  if (branches.length <= 1) return branches[0] ? <span className="hidden text-sm text-ink-2 sm:inline">{branches[0].name}</span> : null;
  return (
    <label className="flex items-center gap-2 text-sm text-ink-2">
      <span className="sr-only">Branch</span>
      <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="h-9 rounded-md border border-line bg-surface px-2 text-ink">
        {me.branchIds === "*" || branches.length > 1 ? <option value="">All branches</option> : null}
        {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
    </label>
  );
}

function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);
  function toggle() {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    try { localStorage.setItem("gym.theme", next ? "dark" : "light"); } catch { /* ignore */ }
    setDark(next);
  }
  return (
    <button onClick={toggle} className="grid size-9 place-items-center rounded-md text-ink-2 hover:bg-surface-2 hover:text-ink" aria-label={dark ? "Switch to light theme" : "Switch to dark theme"} title={dark ? "Light theme" : "Dark theme"}>
      {dark ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" /></svg>
      )}
    </button>
  );
}

interface Hit { id: string; memberCode: string; fullName: string; phoneMasked: string; status: string; currentPlanName: string | null; validUntil: string | null }

/** The front desk's main tool: find a member by name, phone or code. Press "/" from anywhere. */
function MemberSearch() {
  const router = useRouter();
  const { branchId } = useSession();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement)) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      api<{ data: Hit[] }>(`/members?pageSize=8&q=${encodeURIComponent(q.trim())}${branchId ? `&branchId=${branchId}` : ""}`, { signal: ctrl.signal })
        .then((r) => { setHits(r.data); setActive(0); setOpen(true); })
        .catch(() => undefined);
    }, 180);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q, branchId]);

  function go(h: Hit) {
    setOpen(false);
    setQ("");
    router.push(`/members/${h.id}`);
  }

  return (
    <div className="relative w-full max-w-md">
      <svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
      <input
        ref={input}
        type="search"
        role="combobox"
        aria-expanded={open}
        aria-controls="member-search-results"
        aria-label="Find a member by name, phone or member code"
        placeholder="Find member — name, phone or code"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => hits.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, hits.length - 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          if (e.key === "Enter" && hits[active]) go(hits[active]);
          if (e.key === "Escape") { setOpen(false); input.current?.blur(); }
        }}
        className="h-10 w-full rounded-md border border-line bg-surface pl-9 pr-10 text-ink placeholder:text-ink-3 focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/20"
      />
      <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-line px-1.5 text-xs text-ink-3 sm:block">/</kbd>
      {open && q.trim().length >= 2 && (
        <ul id="member-search-results" role="listbox" className="absolute left-0 right-0 top-12 z-30 overflow-hidden rounded-lg border border-line bg-surface shadow-lg">
          {hits.length === 0 && <li className="px-4 py-3 text-sm text-ink-3">No member matches “{q.trim()}”.</li>}
          {hits.map((h, i) => (
            <li key={h.id} role="option" aria-selected={i === active}>
              <button onMouseDown={(e) => e.preventDefault()} onClick={() => go(h)} onMouseEnter={() => setActive(i)}
                className={cx("flex w-full items-center gap-3 px-4 py-2.5 text-left", i === active && "bg-surface-2")}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{h.fullName}</span>
                  <span className="block text-xs text-ink-3">{h.memberCode} · {h.phoneMasked}{h.currentPlanName ? ` · ${h.currentPlanName}` : ""}</span>
                </span>
                <Status value={h.status} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
