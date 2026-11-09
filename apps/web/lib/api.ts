"use client";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public extra: Record<string, any> = {}) {
    super(message);
  }
  fieldErrors(): Record<string, string> {
    return Object.fromEntries((this.extra.errors ?? []).map((e: { field: string; message: string }) => [e.field, e.message]));
  }
}

let csrfToken = "";
export const setCsrf = (t: string) => { csrfToken = t; };

type Opts = { method?: string; body?: unknown; idempotencyKey?: string; signal?: AbortSignal };

export async function api<T = any>(path: string, opts: Opts = {}): Promise<T> {
  const method = opts.method ?? (opts.body !== undefined ? "POST" : "GET");
  const headers: Record<string, string> = { accept: "application/json" };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET") headers["x-csrf-token"] = csrfToken;
  if (opts.idempotencyKey) headers["idempotency-key"] = opts.idempotencyKey;

  let res: Response;
  try {
    res = await fetch("/api/v1" + path, { method, headers, credentials: "same-origin", body: opts.body === undefined ? undefined : JSON.stringify(opts.body), signal: opts.signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(0, "NETWORK", "Can't reach the server. Check the internet connection and try again.");
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/auth/login") && !path.startsWith("/member-auth") && !/^\/(m|pay|join)(\/|$)/.test(window.location.pathname)) {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = `/login?next=${next}`;
    }
    const { code, detail, status, title, type, requestId, ...extra } = data ?? {};
    throw new ApiError(res.status, code ?? "HTTP_" + res.status, detail ?? "Something went wrong", extra);
  }
  return data as T;
}

/** A fresh key per user action; reuse the same key when retrying that action. */
export const newKey = () => crypto.randomUUID();

// ---------- formatting ----------
const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2 });
export const rupees = (paise: number | null | undefined, exact = false) =>
  paise == null ? "—" : (exact || paise % 100 !== 0 ? inr2 : inr).format(paise / 100);
export const toPaise = (rupeesStr: string) => Math.round(Number(rupeesStr.replace(/[^\d.]/g, "")) * 100);

const dFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const dShort = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const dtFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
export const fmtDate = (ymd?: string | null, short = false) => (ymd ? (short ? dShort : dFmt).format(new Date(ymd + "T00:00:00Z")) : "—");
export const fmtDateTime = (iso?: string | null) => (iso ? dtFmt.format(new Date(iso)) : "—");

export function relTime(iso?: string | null) {
  if (!iso) return "";
  const diff = new Date(iso).getTime() - Date.now();
  const days = Math.round(diff / 86_400_000);
  if (Math.abs(diff) < 3600_000) return diff < 0 ? "just now" : "within the hour";
  if (days === 0) return diff < 0 ? "earlier today" : "later today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

/** Today's business date in IST, YYYY-MM-DD. */
export const istToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
export const daysUntil = (ymd: string) => Math.round((Date.parse(ymd + "T00:00:00Z") - Date.parse(istToday() + "T00:00:00Z")) / 86_400_000);

/** Version of the privacy notice shown at registration. Bump when the notice text changes. */
export const PRIVACY_NOTICE_VERSION = "2026-01";

/** Saves rows as a CSV that opens cleanly in Excel (UTF-8 BOM, quoted cells). */
export function downloadCsv(filename: string, header: string[], rows: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    // A leading = + - @ would run as a formula in Excel.
    const safe = /^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? "'" + s : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const csv = "﻿" + [header, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
/** Paise as a plain number of rupees for spreadsheets. */
export const rupeeNum = (paise: number) => (paise / 100).toFixed(2);

/** A calendar month in IST: offset 0 = this month (to today), -1 = last month… */
export function monthRange(offset = 0) {
  const [y, m] = istToday().split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + offset, 1));
  const from = d.toISOString().slice(0, 10);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  return { from, to: offset === 0 ? istToday() : last, label: new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).format(d) };
}
