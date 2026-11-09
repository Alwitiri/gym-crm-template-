"use client";

import Link from "next/link";
import { useState } from "react";
import { Empty, ErrorNote, LinkButton, PageHeader, Panel, Skeleton, cx } from "@/components/ui";
import { daysUntil, fmtDate, rupees } from "@/lib/api";
import { useApi, useSession } from "@/lib/session";

interface Dash {
  period: { from: string; to: string };
  today: { checkIns: number; insideNow: number; ptSessions: number };
  members: { total: number; active: number; expired: number; frozen: number; prospects: number; newRegistrations: number };
  leads: { new: number; converted: number; followUpsDue: number; conversionRateBp: number };
  renewals: { dueNext7Days: number; expiredLast30DaysNotRenewed: number; upcoming: { subscriptionId: string; memberId: string; memberCode: string; memberName: string; planName: string; endDate: string }[] };
  revenue?: { collectedPaise: number; duesPaise: number; byMethod: Record<string, number> };
  revenueSeries?: { date: string; collectedPaise: number }[];
}

const PERIODS = [
  ["today", "Today"], ["yesterday", "Yesterday"], ["this_week", "This week"], ["this_month", "This month"], ["last_month", "Last month"],
] as const;

export default function DashboardPage() {
  const { me, branchId, can, branches } = useSession();
  const [period, setPeriod] = useState<string>("today");
  const { data, error, loading } = useApi<Dash>(`/dashboard?period=${period}${branchId ? `&branchId=${branchId}` : ""}`);
  const branchName = branchId ? branches.find((b) => b.id === branchId)?.name : branches.length === 1 ? branches[0]?.name : null;
  const hour = Number(new Intl.DateTimeFormat("en-IN", { hour: "numeric", hourCycle: "h23", timeZone: "Asia/Kolkata" }).format(new Date()));
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <>
      <PageHeader
        title={`${greeting}, ${me.displayName.split(" ")[0]}`}
        description={branchName ? `Here's how ${branchName} is doing.` : branches.length > 1 ? "Here's how all branches are doing." : undefined}
        actions={
          <>
            {can("members.create") && <LinkButton href="/members/new">Register member</LinkButton>}
            {can("leads.create") && <LinkButton href="/leads?new=1" variant="secondary">Add lead</LinkButton>}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap gap-1" role="tablist" aria-label="Period">
        {PERIODS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={period === k} onClick={() => setPeriod(k)}
            className={cx("h-8 rounded-md px-3 text-sm font-medium", period === k ? "bg-ink text-chalk" : "text-ink-2 hover:bg-surface-2")}>
            {label}
          </button>
        ))}
      </div>

      <ErrorNote error={error} />
      {!data && loading && <Panel><Skeleton rows={3} /></Panel>}
      {data && (
        <div className={cx("space-y-6 transition-opacity", loading && "opacity-60")}>
          <Scoreboard data={data} />

          <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
            {data.revenueSeries && data.revenue ? <Collections data={data} /> : <MemberMix data={data} />}
            <Panel title="Renewals due this week" padded={false}
              actions={<span className="text-sm text-ink-3">{data.renewals.expiredLast30DaysNotRenewed} lapsed in the last 30 days</span>}>
              {data.renewals.upcoming.length === 0 ? (
                <Empty title="No renewals due in the next 7 days" />
              ) : (
                <ul>
                  {data.renewals.upcoming.map((r) => {
                    const days = daysUntil(r.endDate);
                    return (
                      <li key={r.subscriptionId} className="border-b border-line last:border-0">
                        <Link href={`/members/${r.memberId}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">{r.memberName}</span>
                            <span className="block text-xs text-ink-3">{r.planName}, ends {fmtDate(r.endDate, true)}</span>
                          </span>
                          <span className={cx("font-cond text-lg font-semibold", days <= 2 ? "text-red" : "text-yellow")}>
                            {days === 0 ? "Today" : days === 1 ? "Tomorrow" : `${days} days`}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>
          </div>

          {data.revenue && data.revenueSeries && <MemberMix data={data} />}
        </div>
      )}
    </>
  );
}

/** One strip with dividers, read left to right like a scoreboard. */
function Scoreboard({ data }: { data: Dash }) {
  const cells: { label: string; value: string; note?: string; tone?: string; href?: string }[] = [
    { label: "Active members", value: data.members.active.toLocaleString("en-IN"), note: `of ${data.members.total.toLocaleString("en-IN")} registered`, href: "/members?status=ACTIVE" },
    { label: "Check-ins today", value: String(data.today.checkIns), note: `${data.today.insideNow} in the gym now, ${data.members.newRegistrations} new member${data.members.newRegistrations === 1 ? "" : "s"}`, href: "/attendance" },
    ...(data.revenue
      ? [
          { label: "Collected", value: rupees(data.revenue.collectedPaise), href: "/payments" },
          { label: "Outstanding dues", value: rupees(data.revenue.duesPaise), tone: data.revenue.duesPaise > 0 ? "text-red" : undefined, href: "/members?hasDues=true" },
        ]
      : []),
    { label: "Renewals this week", value: String(data.renewals.dueNext7Days), tone: data.renewals.dueNext7Days ? "text-yellow" : undefined, href: "/members?expiringWithinDays=7" },
    { label: "Lead follow-ups due", value: String(data.leads.followUpsDue), tone: data.leads.followUpsDue ? "text-red" : undefined, note: `${data.leads.new} new, ${data.leads.converted} joined`, href: "/leads?followUpDue=true" },
  ];
  return (
    <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-line bg-surface sm:grid-cols-3 xl:grid-cols-6">
      {cells.map((c) => {
        const inner = (
          <>
            <span className="text-sm text-ink-2">{c.label}</span>
            <span className={cx("mt-1 block font-cond text-[2.4rem] font-semibold leading-none", c.tone)}>{c.value}</span>
            {c.note && <span className="mt-1.5 block text-xs text-ink-3">{c.note}</span>}
          </>
        );
        const cls = "block border-b border-r border-line px-4 py-4 -mb-px -mr-px";
        return c.href ? <Link key={c.label} href={c.href} className={cx(cls, "hover:bg-surface-2")}>{inner}</Link> : <div key={c.label} className={cls}>{inner}</div>;
      })}
    </div>
  );
}

function Collections({ data }: { data: Dash }) {
  const series = data.revenueSeries!;
  const max = Math.max(1, ...series.map((s) => s.collectedPaise));
  const total = series.reduce((s, x) => s + x.collectedPaise, 0);
  const methods = Object.entries(data.revenue!.byMethod).sort((a, b) => b[1] - a[1]);
  const methodTotal = methods.reduce((s, [, v]) => s + v, 0);
  const label: Record<string, string> = { CASH: "Cash", UPI: "UPI", CARD: "Card", BANK_TRANSFER: "Bank transfer", GATEWAY: "Online" };
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover != null ? series[hover] : null;

  return (
    <Panel title="Collections, last 30 days" actions={<span className="font-cond text-lg font-semibold">{rupees(total)}</span>}>
      <div className="h-6 text-sm text-ink-2" aria-live="polite">
        {shown ? <>{fmtDate(shown.date)}: <strong className="text-ink">{rupees(shown.collectedPaise)}</strong></> : "Point at a bar to see that day."}
      </div>
      <svg viewBox="0 0 300 100" className="mt-2 h-40 w-full" preserveAspectRatio="none" role="img" aria-label={`Daily collections over 30 days, total ${rupees(total)}`}>
        {series.map((s, i) => {
          const h = (s.collectedPaise / max) * 92;
          return (
            <rect key={s.date} x={i * 10 + 1} y={100 - Math.max(h, s.collectedPaise ? 1.5 : 0.6)} width="8" height={Math.max(h, s.collectedPaise ? 1.5 : 0.6)}
              rx="1" className={cx(i === series.length - 1 ? "fill-ink" : "fill-ink-3/60", hover === i && "fill-blue")}
              onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
          );
        })}
      </svg>
      <div className="mt-1 flex justify-between text-xs text-ink-3">
        <span>{fmtDate(series[0].date, true)}</span><span>Today</span>
      </div>
      {methods.length > 0 && (
        <div className="mt-5">
          <p className="mb-2 text-sm text-ink-2">How members paid ({data.period.from === data.period.to ? fmtDate(data.period.from, true) : `${fmtDate(data.period.from, true)} to ${fmtDate(data.period.to, true)}`})</p>
          <div className="flex h-2.5 overflow-hidden rounded-full bg-surface-2">
            {methods.map(([m, v], i) => <div key={m} style={{ width: `${(v / methodTotal) * 100}%` }} className={["bg-blue", "bg-green", "bg-yellow", "bg-red", "bg-ink-3"][i % 5]} />)}
          </div>
          <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
            {methods.map(([m, v], i) => (
              <li key={m} className="flex items-center gap-1.5">
                <span className={cx("size-2.5 rounded-sm", ["bg-blue", "bg-green", "bg-yellow", "bg-red", "bg-ink-3"][i % 5])} aria-hidden />
                {label[m] ?? m} <span className="text-ink-2">{rupees(v)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

function MemberMix({ data }: { data: Dash }) {
  const m = data.members;
  const parts = [
    { k: "Active", v: m.active, c: "bg-green", s: "ACTIVE" },
    { k: "Expired", v: m.expired, c: "bg-red", s: "EXPIRED" },
    { k: "Frozen", v: m.frozen, c: "bg-blue", s: "FROZEN" },
    { k: "Not started", v: m.prospects, c: "bg-ink-3", s: "PROSPECT" },
  ];
  const total = Math.max(1, parts.reduce((s, p) => s + p.v, 0));
  return (
    <Panel title="Members by status">
      <div className="flex h-3 overflow-hidden rounded-full bg-surface-2">
        {parts.map((p) => p.v > 0 && <div key={p.k} className={p.c} style={{ width: `${(p.v / total) * 100}%` }} />)}
      </div>
      <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {parts.map((p) => (
          <li key={p.k}>
            <Link href={`/members?status=${p.s}`} className="block rounded-md p-2 hover:bg-surface-2">
              <span className="flex items-center gap-2 text-sm text-ink-2"><span className={cx("size-2.5 rounded-sm", p.c)} aria-hidden />{p.k}</span>
              <span className="font-cond text-2xl font-semibold">{p.v}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
