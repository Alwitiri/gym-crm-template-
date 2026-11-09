"use client";

import Link from "next/link";
import { useState } from "react";
import { Empty, ErrorNote, PageHeader, Panel, Skeleton, Table, Td, Th, cx } from "@/components/ui";
import { fmtDate, fmtDateTime, rupees } from "@/lib/api";
import { useApi, useSession } from "@/lib/session";

interface Res {
  from: string; to: string; totalPaise: number; totalsByMethod: Record<string, number>;
  data: { id: string; receiptNumber: string; method: string; amountPaise: number; referenceNumber: string | null; receivedAt: string; receivedByName: string | null; memberId: string; memberName: string | null; memberCode: string | null; invoices: string[] }[];
}
const METHOD: Record<string, string> = { CASH: "Cash", UPI: "UPI", CARD: "Card", BANK_TRANSFER: "Bank transfer", GATEWAY: "Online" };

export default function PaymentsPage() {
  const { branchId } = useSession();
  const [period, setPeriod] = useState("today");
  const [method, setMethod] = useState("");
  const { data, error, loading } = useApi<Res>(`/payments?period=${period}${branchId ? `&branchId=${branchId}` : ""}`);
  const rows = data ? data.data.filter((p) => !method || p.method === method) : [];

  return (
    <>
      <PageHeader title="Collections" description="Money received at the desk. Use this to cash up at the end of a shift." />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          {[["today", "Today"], ["yesterday", "Yesterday"], ["this_week", "This week"], ["this_month", "This month"]].map(([k, l]) => (
            <button key={k} onClick={() => setPeriod(k)} aria-pressed={period === k} className={cx("h-8 rounded-md px-3 text-sm font-medium", period === k ? "bg-ink text-chalk" : "text-ink-2 hover:bg-surface-2")}>{l}</button>
          ))}
        </div>
      </div>
      <ErrorNote error={error} />
      {data && (
        <div className="mb-6 grid grid-cols-2 overflow-hidden rounded-lg border border-line bg-surface sm:grid-cols-5">
          <button onClick={() => setMethod("")} aria-pressed={!method} className={cx("-mb-px -mr-px border-b border-r border-line px-4 py-4 text-left hover:bg-surface-2", !method && "bg-surface-2")}>
            <span className="text-sm text-ink-2">Total</span>
            <span className="block font-cond text-3xl font-semibold">{rupees(data.totalPaise)}</span>
          </button>
          {["CASH", "UPI", "CARD", "BANK_TRANSFER"].map((m) => (
            <button key={m} onClick={() => setMethod(method === m ? "" : m)} aria-pressed={method === m} className={cx("-mb-px -mr-px border-b border-r border-line px-4 py-4 text-left hover:bg-surface-2", method === m && "bg-surface-2")}>
              <span className="text-sm text-ink-2">{METHOD[m]}</span>
              <span className="block font-cond text-3xl font-semibold">{rupees(data.totalsByMethod[m] ?? 0)}</span>
            </button>
          ))}
        </div>
      )}
      <Panel padded={false} title={data ? (data.from === data.to ? fmtDate(data.from) : `${fmtDate(data.from)} to ${fmtDate(data.to)}`) : undefined}>
        {!data && loading ? <Skeleton /> : data && rows.length === 0 ? <Empty title={method ? `No ${METHOD[method]} payments in this period` : "No payments in this period"} /> : data && (
          <Table>
            <thead><tr><Th>Time</Th><Th>Member</Th><Th>Method</Th><Th>Receipt</Th><Th>Taken by</Th><Th className="text-right">Amount</Th></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <Td className="whitespace-nowrap text-ink-2">{fmtDateTime(p.receivedAt)}</Td>
                  <Td><Link href={`/members/${p.memberId}`} className="font-medium hover:underline">{p.memberName}</Link><div className="text-xs text-ink-3">{p.memberCode}</div></Td>
                  <Td>{METHOD[p.method]}{p.referenceNumber && <div className="text-xs text-ink-3">{p.referenceNumber}</div>}</Td>
                  <Td className="text-ink-2">{p.receiptNumber}</Td>
                  <Td className="text-ink-2">{p.receivedByName}</Td>
                  <Td className="text-right font-medium">{rupees(p.amountPaise, true)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </>
  );
}
