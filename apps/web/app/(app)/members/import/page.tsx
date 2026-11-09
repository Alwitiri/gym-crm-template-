"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, ErrorNote, PageHeader, Panel, Select, Stat, Status, Table, Td, Th, cx } from "@/components/ui";
import { api, ApiError, downloadCsv, fmtDate, rupees } from "@/lib/api";
import { useApi, useSession } from "@/lib/session";

const FIELDS = [
  ["firstName", "First name", /^(first ?name|name|member ?name|full ?name)$/i],
  ["lastName", "Last name", /^(last ?name|surname)$/i],
  ["phone", "Mobile", /^(mobile|phone|mobile ?(no|number)|phone ?(no|number)|contact)$/i],
  ["email", "Email", /^e-?mail/i],
  ["gender", "Gender", /^(gender|sex)$/i],
  ["dateOfBirth", "Date of birth", /^(dob|date ?of ?birth|birthday)$/i],
  ["joinedOn", "Joined on", /^(joined|joined ?on|joining ?date|doj|admission ?date)$/i],
  ["planName", "Plan", /^(plan|package|plan ?name|membership)$/i],
  ["startDate", "Start date", /^(start|start ?date|from|valid ?from)$/i],
  ["endDate", "End date", /^(end|end ?date|to|valid ?(till|to|until)|expiry|expiry ?date)$/i],
  ["amountDue", "Balance due (₹)", /^(due|balance|amount ?due|pending|balance ?due)$/i],
] as const;
type Key = (typeof FIELDS)[number][0];

interface CheckRow { row: number; ok: boolean; errors: string[]; warnings: string[]; name: string; phone: string; plan: string | null; status: string | null; endDate: string | null; duePaise: number }
interface Result { dryRun: boolean; summary: { total: number; ready: number; withErrors: number; activeMemberships: number; expiredMemberships: number; openingDuesPaise: number; created?: number }; rows: CheckRow[] }

const cell = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v == null ? "" : typeof v === "number" ? v : String(v).trim());

export default function ImportPage() {
  const { branches, branchId } = useSession();
  const plans = useApi<{ name: string }[]>("/membership-plans");
  const [branch, setBranch] = useState(branchId || branches[0]?.id || "");
  const [file, setFile] = useState<string>("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [raw, setRaw] = useState<unknown[][]>([]);
  const [map, setMap] = useState<Partial<Record<Key, number>>>({});
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [onlyProblems, setOnlyProblems] = useState(false);

  async function load(f: File) {
    setErr(null); setResult(null);
    try {
      let rows: unknown[][];
      if (/\.xlsx$/i.test(f.name)) {
        const { readSheet } = await import("read-excel-file/browser");
        rows = (await readSheet(f)) as unknown[][];
      } else if (/\.(csv|txt)$/i.test(f.name)) {
        const Papa = (await import("papaparse")).default;
        rows = Papa.parse<string[]>(await f.text(), { skipEmptyLines: true }).data;
      } else throw new Error("Choose an Excel (.xlsx) or CSV file. For old .xls files, open in Excel and Save As .xlsx first.");
      const hi = rows.findIndex((r) => r.filter((c) => c != null && String(c).trim()).length >= 2);
      if (hi < 0) throw new Error("The file looks empty.");
      const hdr = rows[hi].map((c) => String(c ?? "").trim());
      const body = rows.slice(hi + 1).filter((r) => r.some((c) => c != null && String(c).trim()));
      if (body.length > 3000) throw new Error(`The file has ${body.length} rows. Split it into files of 3,000 rows or fewer.`);
      const guess: Partial<Record<Key, number>> = {};
      for (const [k, , re] of FIELDS) { const i = hdr.findIndex((h) => re.test(h)); if (i >= 0) guess[k] = i; }
      setFile(f.name); setHeaders(hdr); setRaw(body); setMap(guess);
    } catch (e) { setErr(e); }
  }

  const rows = () => raw.map((r) => Object.fromEntries(FIELDS.filter(([k]) => map[k] != null).map(([k]) => [k, cell(r[map[k]!])])));

  async function run(dryRun: boolean) {
    setBusy(true); setErr(null);
    try { setResult(await api<Result>(`/imports/members?dryRun=${dryRun}`, { body: { branchId: branch, rows: rows() } })); } catch (e) { setErr(e as ApiError); } finally { setBusy(false); }
  }

  function template() {
    downloadCsv("member-import-template.csv", FIELDS.map(([, l]) => l.replace(" (₹)", "")), [
      ["Priya", "Raman", "9876543210", "priya@example.com", "F", "14/02/1995", "01/04/2025", plans.data?.[0]?.name ?? "Monthly", "01/11/2026", "30/11/2026", "0"],
      ["Arun", "", "9876501234", "", "M", "", "15/06/2024", plans.data?.[0]?.name ?? "Monthly", "10/10/2026", "08/11/2026", "1500"],
    ]);
  }

  const shown = result ? result.rows.filter((r) => !onlyProblems || !r.ok || r.warnings.length) : [];
  const done = result && !result.dryRun;

  return (
    <>
      <PageHeader title="Import members" description="Bring your existing members over from a register or spreadsheet. Nothing is saved until you press Import."
        actions={<Button variant="secondary" onClick={template}>Download template</Button>} />
      <div className="grid gap-6">
        <Panel title="1 · Choose the file">
          <div className="flex flex-wrap items-end gap-4">
            {branches.length > 1 && (
              <Select label="Import into branch" value={branch} onChange={(e) => setBranch(e.target.value)} wrapClass="w-56">
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            )}
            <label className="flex h-10 cursor-pointer items-center rounded-md border border-dashed border-ink-3 px-4 font-medium hover:bg-surface-2">
              <input type="file" accept=".xlsx,.csv" className="sr-only" onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
              {file ? `Change file (${file})` : "Choose Excel or CSV file"}
            </label>
            {raw.length > 0 && <span className="pb-2 text-ink-2">{raw.length} rows found</span>}
          </div>
          <p className="mt-3 text-sm text-ink-3">Dates can be 07/11/2026, 2026-11-07 or Excel dates. Mobile numbers can be with or without +91. Members with the same mobile number as an existing member are skipped.</p>
        </Panel>

        {headers.length > 0 && (
          <Panel title="2 · Match your columns">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {FIELDS.map(([k, label]) => (
                <Select key={k} label={label + (k === "firstName" || k === "phone" ? " *" : "")} value={map[k] ?? ""} onChange={(e) => setMap({ ...map, [k]: e.target.value === "" ? undefined : Number(e.target.value) })}>
                  <option value="">— not in file —</option>
                  {headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                </Select>
              ))}
            </div>
            <p className="mt-3 text-sm text-ink-3">Plan names must match a plan on the Plans page ({(plans.data ?? []).map((p) => p.name).join(", ")}). Rows without a plan are added as members with no current membership.</p>
            <div className="mt-4 flex gap-2">
              <Button onClick={() => run(true)} busy={busy && !result} disabled={map.firstName == null || map.phone == null}>Check the file</Button>
            </div>
          </Panel>
        )}
        <ErrorNote error={err} />

        {result && (
          <Panel title={done ? "Imported" : "3 · Review and import"} actions={!done && (
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} /> Show only rows with problems</label>
          )}>
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
              <Stat label="Rows" value={result.summary.total} />
              <Stat label={done ? "Created" : "Ready to import"} value={done ? result.summary.created : result.summary.ready} tone="green" />
              <Stat label="Will be skipped" value={result.summary.withErrors} tone={result.summary.withErrors ? "red" : undefined} />
              <Stat label="Active / expired" value={`${result.summary.activeMemberships} / ${result.summary.expiredMemberships}`} />
              <Stat label="Opening dues" value={rupees(result.summary.openingDuesPaise)} />
            </div>
            <Table>
              <thead><tr><Th>Row</Th><Th>Name</Th><Th>Mobile</Th><Th>Plan</Th><Th>Ends</Th><Th className="text-right">Due</Th><Th>Check</Th></tr></thead>
              <tbody>
                {shown.slice(0, 500).map((r) => (
                  <tr key={r.row} className={cx(!r.ok && "bg-tint-red/40")}>
                    <Td className="text-ink-3">{r.row}</Td>
                    <Td className="font-medium">{r.name || "—"}</Td>
                    <Td className="text-ink-2">{r.phone}</Td>
                    <Td>{r.plan ?? "—"}</Td>
                    <Td>{r.endDate ? <>{fmtDate(r.endDate)} {r.status && <Status value={r.status} className="ml-1" />}</> : "—"}</Td>
                    <Td className="text-right">{r.duePaise ? rupees(r.duePaise) : ""}</Td>
                    <Td>{r.errors.map((e, i) => <div key={i} className="text-red">{e}</div>)}{r.warnings.map((w, i) => <div key={i} className="text-ink-3">{w}</div>)}{r.ok && !r.warnings.length && <span className="text-green">OK</span>}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {shown.length > 500 && <p className="mt-2 text-sm text-ink-3">Showing the first 500 rows.</p>}
            <div className="mt-5 flex items-center gap-3">
              {done ? (
                <Link href="/members" className="font-semibold text-blue hover:underline">Go to members →</Link>
              ) : (
                <>
                  <Button onClick={() => run(false)} busy={busy} disabled={!result.summary.ready}>Import {result.summary.ready} members</Button>
                  <span className="text-sm text-ink-3">Rows with problems are skipped. Fix them in the file and import again — already-imported members won't be duplicated.</span>
                </>
              )}
            </div>
          </Panel>
        )}
      </div>
    </>
  );
}
