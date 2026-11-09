"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Empty, ErrorNote, LinkButton, PageHeader, Pager, Panel, Skeleton, Status, Table, Td, Th, cx } from "@/components/ui";
import { fmtDate, rupees } from "@/lib/api";
import { useApi, useSession } from "@/lib/session";

interface Row { id: string; memberCode: string; fullName: string; phoneMasked: string; status: string; currentPlanName: string | null; validUntil: string | null; daysRemaining: number | null; duesPaise?: number; joinedOn: string }
interface Page { page: number; pageSize: number; total: number; data: Row[] }

const FILTERS = [
  { key: "", label: "Everyone" },
  { key: "status=ACTIVE", label: "Active" },
  { key: "expiringWithinDays=7", label: "Expiring in 7 days" },
  { key: "status=EXPIRED", label: "Expired" },
  { key: "hasDues=true", label: "Owe money", perm: "invoices.read" },
  { key: "status=PROSPECT", label: "Not started" },
];

function MembersInner() {
  const { branchId, can } = useSession();
  const params = useSearchParams();
  const router = useRouter();
  const initialFilter = FILTERS.find((f) => f.key && params.toString().includes(f.key))?.key ?? "";
  const [filter, setFilter] = useState(initialFilter);
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  useEffect(() => setPage(1), [filter, debounced, branchId]);

  const qs = [`page=${page}`, "pageSize=25", filter, debounced.length >= 2 ? `q=${encodeURIComponent(debounced)}` : "", branchId ? `branchId=${branchId}` : ""].filter(Boolean).join("&");
  const { data, error, loading } = useApi<Page>(`/members?${qs}`);
  const showDues = can("invoices.read");

  return (
    <>
      <PageHeader
        title="Members"
        description={data ? `${data.total.toLocaleString("en-IN")} ${filter ? "matching" : "registered"}` : undefined}
        actions={<>{can("members.import") && <LinkButton variant="secondary" href="/members/import">Import</LinkButton>}{can("members.create") && <LinkButton href="/members/new">Register member</LinkButton>}</>}
      />
      <Panel padded={false}>
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-3">
          <input type="search" aria-label="Filter by name, phone or code" placeholder="Filter by name, phone or code" value={q} onChange={(e) => setQ(e.target.value)}
            className="h-9 w-full max-w-xs rounded-md border border-line bg-surface px-3 placeholder:text-ink-3 focus:border-blue focus:outline-none" />
          <div className="flex flex-wrap gap-1">
            {FILTERS.filter((f) => !f.perm || can(f.perm)).map((f) => (
              <button key={f.key} onClick={() => { setFilter(f.key); router.replace(f.key ? `/members?${f.key}` : "/members"); }} aria-pressed={filter === f.key}
                className={cx("h-8 rounded-md px-3 text-sm font-medium", filter === f.key ? "bg-ink text-chalk" : "text-ink-2 hover:bg-surface-2")}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <ErrorNote error={error} />
        {!data && loading ? <Skeleton rows={8} /> : data && data.data.length === 0 ? (
          <Empty title={debounced ? `No member matches “${debounced}”` : "No members here yet"}>
            {can("members.create") && !debounced && <>Register the first one, or <Link className="underline" href="/leads">convert a lead</Link>.</>}
          </Empty>
        ) : data && (
          <div className={cx(loading && "opacity-60")}>
            <Table>
              <thead><tr><Th>Member</Th><Th>Plan</Th><Th>Valid until</Th><Th>Status</Th>{showDues && <Th className="text-right">Dues</Th>}<Th className="hidden md:table-cell">Joined</Th></tr></thead>
              <tbody>
                {data.data.map((m) => (
                  <tr key={m.id} className="group cursor-pointer hover:bg-surface-2" onClick={() => router.push(`/members/${m.id}`)}>
                    <Td>
                      <Link href={`/members/${m.id}`} className="font-medium group-hover:underline" onClick={(e) => e.stopPropagation()}>{m.fullName}</Link>
                      <div className="text-xs text-ink-3">{m.memberCode} · {m.phoneMasked}</div>
                    </Td>
                    <Td>{m.currentPlanName ?? <span className="text-ink-3">—</span>}</Td>
                    <Td>
                      {m.validUntil ? fmtDate(m.validUntil) : "—"}
                      {m.daysRemaining != null && m.daysRemaining <= 7 && <div className="text-xs font-medium text-yellow">{m.daysRemaining <= 0 ? "Ends today" : `${m.daysRemaining} days left`}</div>}
                    </Td>
                    <Td><Status value={m.status} /></Td>
                    {showDues && <Td className={cx("text-right", m.duesPaise ? "font-semibold text-red" : "text-ink-3")}>{m.duesPaise ? rupees(m.duesPaise) : "—"}</Td>}
                    <Td className="hidden text-ink-2 md:table-cell">{fmtDate(m.joinedOn)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </div>
        )}
      </Panel>
    </>
  );
}

export default function MembersPage() {
  return <Suspense><MembersInner /></Suspense>;
}
