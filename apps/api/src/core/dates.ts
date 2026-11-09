import { config } from "./config";

/** Business date (YYYY-MM-DD) in IST for an instant. */
export function istDate(at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: config.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/** A YYYY-MM-DD business date as the Date Prisma expects for @db.Date columns. */
export function dbDate(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

export function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(ymdStr: string, days: number): string {
  const d = dbDate(ymdStr);
  d.setUTCDate(d.getUTCDate() + days);
  return ymd(d);
}

export function diffDays(fromYmd: string, toYmd: string): number {
  return Math.round((dbDate(toYmd).getTime() - dbDate(fromYmd).getTime()) / 86_400_000);
}

/** Start of an IST day as a UTC instant. */
export function istDayStart(ymdStr: string): Date {
  return new Date(`${ymdStr}T00:00:00+05:30`);
}

/** Indian financial year label, e.g. "2026-27" for 7 Nov 2026. */
export function financialYear(ymdStr: string): string {
  const [y, m] = ymdStr.split("-").map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

export type Period = "today" | "yesterday" | "this_week" | "this_month" | "last_month" | "custom";

/** Period → [from, to) as UTC instants, plus the inclusive business dates. */
export function periodRange(period: Period, from?: string, to?: string) {
  const today = istDate();
  let a = today;
  let b = today;
  if (period === "yesterday") a = b = addDays(today, -1);
  else if (period === "this_week") {
    const dow = dbDate(today).getUTCDay(); // 0 Sun
    a = addDays(today, -((dow + 6) % 7)); // Monday
  } else if (period === "this_month") a = today.slice(0, 8) + "01";
  else if (period === "last_month") {
    const firstThis = today.slice(0, 8) + "01";
    b = addDays(firstThis, -1);
    a = b.slice(0, 8) + "01";
  } else if (period === "custom" && from && to) {
    a = from;
    b = to;
  }
  return { fromDate: a, toDate: b, start: istDayStart(a), end: istDayStart(addDays(b, 1)) };
}
