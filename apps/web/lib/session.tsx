"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, setCsrf } from "./api";

export interface Me {
  id: string;
  displayName: string;
  kind: "STAFF" | "MEMBER";
  staffId: string | null;
  permissions: string[];
  branchIds: "*" | string[];
  csrfToken: string;
}

export interface Branch { id: string; code: string; name: string; city: string; status: string }

interface SessionValue {
  me: Me;
  branches: Branch[];
  /** "" = every branch in my scope */
  branchId: string;
  setBranchId: (id: string) => void;
  can: (perm: string) => boolean;
  refresh: () => Promise<void>;
}

const Ctx = createContext<SessionValue | null>(null);

function stored(key: string) {
  try { return localStorage.getItem(key) ?? ""; } catch { return ""; }
}
function store(key: string, v: string) {
  try { localStorage.setItem(key, v); } catch { /* storage unavailable: keep in memory */ }
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{ me: Me; branches: Branch[] } | null>(null);
  const [branchId, setBranch] = useState("");

  const refresh = useCallback(async () => {
    const me = await api<Me>("/auth/me");
    setCsrf(me.csrfToken);
    // Members have their own app.
    if (me.kind === "MEMBER") { window.location.replace("/m"); return; }
    const branches = me.permissions.includes("branches.read") ? await api<Branch[]>("/branches") : [];
    setState({ me, branches });
    const saved = stored("gym.branch");
    // Single-branch staff are pinned to their branch; others resume their last choice.
    if (branches.length === 1) setBranch(branches[0].id);
    else if (saved && branches.some((b) => b.id === saved)) setBranch(saved);
  }, []);

  useEffect(() => { void refresh().catch(() => undefined); }, [refresh]);

  if (!state) {
    return (
      <div className="grid min-h-screen place-items-center text-ink-3" role="status">
        <span className="font-cond text-lg">Loading…</span>
      </div>
    );
  }

  const value: SessionValue = {
    ...state,
    branchId,
    setBranchId: (id) => { setBranch(id); store("gym.branch", id); },
    can: (p) => state.me.permissions.includes(p),
    refresh,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession outside SessionProvider");
  return v;
}

/** Small data hook: refetches when deps change; keeps previous data while loading. */
export function useApi<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(!!path);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return;
    const ctrl = new AbortController();
    setLoading(true);
    api<T>(path, { signal: ctrl.signal })
      .then((d) => { setData(d); setError(null); })
      .catch((e) => { if (e.name !== "AbortError") setError(e); })
      .finally(() => { if (!ctrl.signal.aborted) setLoading(false); });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, tick, ...deps]);
  return { data, error, loading, reload: () => setTick((t) => t + 1) };
}
