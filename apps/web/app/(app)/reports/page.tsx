"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, Empty, ErrorNote, PageHeader, Panel, Skeleton, Stat, Status, Table, Tabs, Td, Th, cx } from "@/components/ui";
import { downloadCsv, fmtDate, monthRange, rupeeNum, rupees } from "@/lib/api";
import { useApi, useSession } from "@/lib/session";

type Tab = "profit" | "gst" | "renewals" | "leads" | "trainers";
const METHOD: Record<string, string> = { CASH: "Cash", UPI: "UPI", CARD: "Card", BANK_TRANSFER: "Bank transfer", GATEWAY: "Online" };
const SOURCE: Record<string, string> = { WALK_IN: "Walk-in", WEBSITE: "Website", INSTAGRAM: "Instagram", FACEBOOK: "Facebook", GOOGLE_ADS: "Google ads", WHATSAPP: "WhatsApp", REFERRAL: "Referral", PHONE_CALL: "Phone call", OTHER: "Other" };
const monthLabel = (ym: string) => new Intl.DateTimeFormat("en-IN", { month: "short", timeZone: "UTC" }).format(new Date(ym + "-01T00:00:00Z"));

export default function ReportsPage() {
  const { can, branchId } = useSession();
  const finance = can("reports.finance");
  const [tab, setTab] = useState<Tab>(finance ? "profit" : "renewals");
  const [offset, setOffset] = useState(0);
  const r = monthRange(offset);
  const qs = `from=${r.from}&to=${r.to}${branchId ? `&branchId=${branchId}` : ""}`;
  const items: [Tab, string][] = [
    ...(finance ? ([["profit", "Profit & loss"], ["gst", "GST sales"]] as [Tab, string][]) : []),
    ["renewals", "Renewals"], ["leads", "Leads"], ["trainers", "Trainers"],
  ];
  return (
    <>
      <PageHeader title="Reports" description="How the gym is doing. Every table can be exported for your accountant." />
      <div className="mb-2 flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => setOffset(offset - 1)} aria-label="Previous month">←</Button>
        <span className="min-w-40 text-center font-cond text-xl font-semibold">{r.label}</span>
        <Button size="sm" variant="ghost" onClick={() => setOffset(offset + 1)} disabled={offset >= 0} aria-label="Next month">→</Button>
        {offset === 0 && <span className="text-sm text-ink-3">so far</span>}
      </div>
      <Tabs value={tab} onChange={setTab} items={items} />
      {tab === "profit" && <Profit qs={qs} />}
      {tab === "gst" && <Gst qs={qs} file={`gst-sales-${r.from}-to-${r.to}.csv`} />}
      {tab === "renewals" && <Renewals qs={qs} file={`renewals-${r.from}-to-${r.to}.csv`} />}
      {tab === "leads" && <Leads qs={qs} />}
      {tab === "trainers" && <Trainers qs={qs} file={`trainers-${r.from}-to-${r.to}.csv`} />}
    </>
  );
}

function Profit({ qs }: { qs: string }) {
  const { data, error } = useApi<{ incomePaise: number; payments: number; expensesPaise: number; netPaise: number; incomeByMethod: Record<string, number>; expensesByCategory: { category: string; amountPaise: number }[]; months: { month: string; incomePaise: number; expensesPaise: number }[] }>(`/reports/profit?${qs}`);
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Skeleton />;
  const max = Math.max(1, ...data.months.flatMap((m) => [m.incomePaise, m.expensesPaise]));
  return (
    <div className="grid gap-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Money in" value={rupees(data.incomePaise)} note={`${data.payments} payments`} />
        <Stat label="Expenses" value={rupees(data.expensesPaise)} />
        <Stat label="Net" value={rupees(data.netPaise)} tone={data.netPaise >= 0 ? "green" : "red"} note="Cash basis: payments received minus expenses paid" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Panel title="Last 6 months">
          <div className="flex h-56 items-end gap-3" role="img" aria-label="Income and expenses by month">
            {data.months.map((m) => (
              <div key={m.month} className="flex flex-1 flex-col items-center gap-1">
                <div className="flex h-48 w-full items-end justify-center gap-1">
                  <div className="w-1/3 rounded-t bg-green" style={{ height: `${(m.incomePaise / max) * 100}%` }} title={`Income ${rupees(m.incomePaise)}`} />
                  <div className="w-1/3 rounded-t bg-red/70" style={{ height: `${(m.expensesPaise / max) * 100}%` }} title={`Expenses ${rupees(m.expensesPaise)}`} />
                </div>
                <span className="text-xs text-ink-3">{monthLabel(m.month)}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-4 text-sm text-ink-2"><span className="flex items-center gap-1.5"><i className="size-3 rounded-sm bg-green" />Income</span><span className="flex items-center gap-1.5"><i className="size-3 rounded-sm bg-red/70" />Expenses</span></div>
        </Panel>
        <div className="grid gap-6">
          <Panel title="Income by method">
            {Object.entries(data.incomeByMethod).length === 0 ? <p className="text-ink-3">No payments yet.</p> : Object.entries(data.incomeByMethod).sort((a, b) => b[1] - a[1]).map(([k, v]) => <Row key={k} label={METHOD[k] ?? k} value={v} total={data.incomePaise} />)}
          </Panel>
          <Panel title="Expenses by category">
            {data.expensesByCategory.length === 0 ? <p className="text-ink-3">No expenses recorded. <Link href="/expenses" className="text-blue hover:underline">Add expenses</Link></p> : data.expensesByCategory.map((c) => <Row key={c.category} label={c.category} value={c.amountPaise} total={data.expensesPaise} />)}
          </Panel>
        </div>
      </div>
    </div>
  );
}
function Row({ label, value, total }: { label: string; value: number; total: number }) {
  return (
    <div className="py-1.5">
      <div className="flex justify-between text-sm"><span>{label}</span><span className="font-medium">{rupees(value)}</span></div>
      <div className="mt-1 h-1.5 rounded bg-surface-2"><div className="h-full rounded bg-ink-3" style={{ width: `${total ? (value / total) * 100 : 0}%` }} /></div>
    </div>
  );
}

function Gst({ qs, file }: { qs: string; file: string }) {
  const { data, error } = useApi<{ totals: { invoices: number; voided: number; taxablePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number; totalPaise: number }; data: { invoiceNumber: string; issueDate: string; status: string; branch: string; customer: string; memberCode: string; placeOfSupply: string; sac: string; taxRate: number; taxablePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number; totalPaise: number }[] }>(`/reports/gst?${qs}`);
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Skeleton />;
  const t = data.totals;
  const exp = () => downloadCsv(file, ["Invoice no", "Date", "Status", "Branch", "Customer", "Member code", "Place of supply", "SAC", "GST rate %", "Taxable (₹)", "CGST (₹)", "SGST (₹)", "IGST (₹)", "Invoice total (₹)"],
    data.data.map((i) => [i.invoiceNumber, i.issueDate, i.status === "VOID" ? "Cancelled" : "Issued", i.branch, i.customer, i.memberCode, i.placeOfSupply, i.sac, i.taxRate, ...(i.status === "VOID" ? [0, 0, 0, 0, 0] : [i.taxablePaise, i.cgstPaise, i.sgstPaise, i.igstPaise, i.totalPaise].map(rupeeNum))]));
  return (
    <div className="grid gap-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Invoices" value={t.invoices} note={t.voided ? `${t.voided} cancelled` : undefined} />
        <Stat label="Taxable value" value={rupees(t.taxablePaise)} />
        <Stat label="CGST" value={rupees(t.cgstPaise)} />
        <Stat label="SGST" value={rupees(t.sgstPaise)} />
        <Stat label="Invoice total" value={rupees(t.totalPaise)} />
      </div>
      <Panel title="B2C invoices (for GSTR-1)" padded={false} actions={<Button size="sm" variant="secondary" onClick={exp} disabled={!data.data.length}>Export CSV</Button>}>
        {data.data.length === 0 ? <Empty title="No invoices in this period" /> : (
          <Table>
            <thead><tr><Th>Invoice</Th><Th>Date</Th><Th>Customer</Th><Th>Rate</Th><Th className="text-right">Taxable</Th><Th className="text-right">CGST</Th><Th className="text-right">SGST</Th><Th className="text-right">Total</Th></tr></thead>
            <tbody>
              {data.data.map((i) => (
                <tr key={i.invoiceNumber} className={cx(i.status === "VOID" && "text-ink-3 line-through")}>
                  <Td className="font-medium">{i.invoiceNumber}</Td><Td>{fmtDate(i.issueDate, true)}</Td><Td>{i.customer}<div className="text-xs text-ink-3">{i.memberCode}</div></Td><Td>{i.taxRate}%</Td>
                  <Td className="text-right">{rupees(i.taxablePaise, true)}</Td><Td className="text-right">{rupees(i.cgstPaise, true)}</Td><Td className="text-right">{rupees(i.sgstPaise, true)}</Td><Td className="text-right font-medium">{rupees(i.totalPaise, true)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </div>
  );
}

function Renewals({ qs, file }: { qs: string; file: string }) {
  const { data, error } = useApi<{ endedInPeriod: number; renewed: number; lapsed: number; stillDue: number; renewalRatePct: number | null; data: { memberId: string; memberName: string; memberCode: string; phone: string; planName: string; endDate: string; outcome: "RENEWED" | "DUE" | "LAPSED" }[] }>(`/reports/renewals?${qs}`);
  const [only, setOnly] = useState<"" | "LAPSED" | "DUE">("");
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Skeleton />;
  const rows = data.data.filter((d) => !only || d.outcome === only);
  const label = { RENEWED: "Renewed", DUE: "Not yet due", LAPSED: "Didn't renew" };
  return (
    <div className="grid gap-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Renewal rate" value={data.renewalRatePct == null ? "—" : `${data.renewalRatePct}%`} note="Of memberships that ended" tone={data.renewalRatePct != null && data.renewalRatePct >= 60 ? "green" : undefined} />
        <Stat label="Renewed" value={data.renewed} />
        <Stat label="Didn't renew" value={data.lapsed} tone={data.lapsed ? "red" : undefined} note="Call these first" />
        <Stat label="Ending later this month" value={data.stillDue} />
      </div>
      <Panel padded={false} title="Memberships ending in this period" actions={
        <div className="flex gap-2">
          <select value={only} onChange={(e) => setOnly(e.target.value as any)} className="h-8 rounded-md border border-line bg-surface px-2 text-sm"><option value="">All</option><option value="LAPSED">Didn't renew</option><option value="DUE">Not yet due</option></select>
          <Button size="sm" variant="secondary" onClick={() => downloadCsv(file, ["Member", "Code", "Mobile", "Plan", "Ended / ends", "Outcome"], rows.map((d) => [d.memberName, d.memberCode, d.phone, d.planName, d.endDate, label[d.outcome]]))} disabled={!rows.length}>Export CSV</Button>
        </div>}>
        {rows.length === 0 ? <Empty title="Nothing here" /> : (
          <Table>
            <thead><tr><Th>Member</Th><Th>Plan</Th><Th>Ends</Th><Th>Outcome</Th></tr></thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.memberId + d.endDate}>
                  <Td><Link href={`/members/${d.memberId}`} className="font-medium hover:underline">{d.memberName}</Link><div className="text-xs text-ink-3">{d.memberCode}</div></Td>
                  <Td>{d.planName}</Td><Td>{fmtDate(d.endDate)}</Td>
                  <Td><Status value={d.outcome === "RENEWED" ? "ACTIVE" : d.outcome === "LAPSED" ? "EXPIRED" : "SCHEDULED"} className="mr-1" /> <span className="text-sm text-ink-2">{label[d.outcome]}</span></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </div>
  );
}

function Leads({ qs }: { qs: string }) {
  const { data, error } = useApi<{ totals: { leads: number; joined: number }; data: { source: string; leads: number; joined: number; lost: number; open: number; conversionPct: number }[]; lostReasons: { reason: string; count: number }[] }>(`/reports/leads?${qs}`);
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Skeleton />;
  return (
    <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
      <Panel title={`${data.totals.leads} enquiries · ${data.totals.joined} joined`} padded={false}>
        {data.data.length === 0 ? <Empty title="No enquiries in this period" /> : (
          <Table>
            <thead><tr><Th>Source</Th><Th className="text-right">Enquiries</Th><Th className="text-right">Joined</Th><Th className="text-right">Lost</Th><Th className="text-right">Still open</Th><Th className="text-right">Conversion</Th></tr></thead>
            <tbody>{data.data.map((s) => <tr key={s.source}><Td className="font-medium">{SOURCE[s.source] ?? s.source}</Td><Td className="text-right">{s.leads}</Td><Td className="text-right">{s.joined}</Td><Td className="text-right">{s.lost}</Td><Td className="text-right">{s.open}</Td><Td className="text-right font-semibold">{s.conversionPct}%</Td></tr>)}</tbody>
          </Table>
        )}
      </Panel>
      <Panel title="Why people didn't join">
        {data.lostReasons.length === 0 ? <p className="text-ink-3">No lost enquiries with a reason.</p> : data.lostReasons.map((l) => <div key={l.reason} className="flex justify-between py-1.5"><span>{l.reason}</span><span className="font-medium">{l.count}</span></div>)}
      </Panel>
    </div>
  );
}

function Trainers({ qs, file }: { qs: string; file: string }) {
  const { data, error } = useApi<{ data: { trainerId: string; name: string; branch: string; activeMembers: number; ptCompleted: number; ptNoShows: number; ptCancelled: number; ptPackagesSold: number; ptRevenuePaise: number }[] }>(`/reports/trainers?${qs}`);
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Skeleton />;
  return (
    <Panel padded={false} title="Trainer performance" actions={<Button size="sm" variant="secondary" onClick={() => downloadCsv(file, ["Trainer", "Branch", "Members", "PT sessions done", "No-shows", "Cancelled", "PT packages sold", "PT revenue excl. GST (₹)"], data.data.map((t) => [t.name, t.branch, t.activeMembers, t.ptCompleted, t.ptNoShows, t.ptCancelled, t.ptPackagesSold, rupeeNum(t.ptRevenuePaise)]))}>Export CSV</Button>}>
      {data.data.length === 0 ? <Empty title="No trainers" /> : (
        <Table>
          <thead><tr><Th>Trainer</Th><Th className="text-right">Members</Th><Th className="text-right">PT done</Th><Th className="text-right">No-shows</Th><Th className="text-right">Packages sold</Th><Th className="text-right">PT revenue</Th></tr></thead>
          <tbody>{data.data.map((t) => <tr key={t.trainerId}><Td className="font-medium">{t.name}<div className="text-xs font-normal text-ink-3">{t.branch}</div></Td><Td className="text-right">{t.activeMembers}</Td><Td className="text-right">{t.ptCompleted}</Td><Td className="text-right">{t.ptNoShows}</Td><Td className="text-right">{t.ptPackagesSold}</Td><Td className="text-right font-medium">{rupees(t.ptRevenuePaise)}</Td></tr>)}</tbody>
        </Table>
      )}
    </Panel>
  );
}
