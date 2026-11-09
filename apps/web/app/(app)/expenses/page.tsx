"use client";

import { useState } from "react";
import { Button, Dialog, Empty, ErrorNote, Input, MoneyInput, PageHeader, Panel, Select, Skeleton, Table, Td, Th, Toast } from "@/components/ui";
import { api, ApiError, downloadCsv, fmtDate, istToday, monthRange, rupeeNum, rupees, toPaise } from "@/lib/api";
import { useApi, useSession } from "@/lib/session";

interface Expense { id: string; expenseDate: string; category: string; description: string; amountPaise: number; gstPaise: number; paymentMethod: string; referenceNumber: string | null; branchName: string; createdByName: string }
interface Res { from: string; to: string; totalPaise: number; byCategory: Record<string, number>; data: Expense[] }
const METHOD: Record<string, string> = { CASH: "Cash", UPI: "UPI", CARD: "Card", BANK_TRANSFER: "Bank transfer" };

export default function ExpensesPage() {
  const { branchId, can } = useSession();
  const [offset, setOffset] = useState(0);
  const r = monthRange(offset);
  const { data, error, loading, reload } = useApi<Res>(`/expenses?from=${r.from}&to=${r.to}${branchId ? `&branchId=${branchId}` : ""}`);
  const [adding, setAdding] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  async function remove(e: Expense) {
    if (!confirm(`Delete "${e.description}" (${rupees(e.amountPaise)})?`)) return;
    await api(`/expenses/${e.id}`, { method: "DELETE" }).then(() => { setToast("Expense deleted"); reload(); }).catch((x) => setToast(x.message));
  }
  function exportCsv() {
    if (!data) return;
    downloadCsv(`expenses-${r.from}-to-${r.to}.csv`, ["Date", "Branch", "Category", "Description", "Amount (₹)", "GST included (₹)", "Paid by", "Reference", "Added by"],
      data.data.map((e) => [e.expenseDate, e.branchName, e.category, e.description, rupeeNum(e.amountPaise), rupeeNum(e.gstPaise), METHOD[e.paymentMethod], e.referenceNumber, e.createdByName]));
  }

  const cats = data ? Object.entries(data.byCategory).sort((a, b) => b[1] - a[1]) : [];
  return (
    <>
      <PageHeader title="Expenses" description="Rent, salaries, bills and purchases — so the profit report shows what you actually keep."
        actions={<>
          <Button variant="secondary" onClick={exportCsv} disabled={!data?.data.length}>Export CSV</Button>
          {can("expenses.manage") && <Button onClick={() => setAdding(true)}>Add expense</Button>}
        </>} />
      <div className="mb-4 flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => setOffset(offset - 1)} aria-label="Previous month">←</Button>
        <span className="min-w-40 text-center font-cond text-xl font-semibold">{r.label}</span>
        <Button size="sm" variant="ghost" onClick={() => setOffset(offset + 1)} disabled={offset >= 0} aria-label="Next month">→</Button>
      </div>
      <ErrorNote error={error} />
      {data && (
        <div className="mb-6 flex flex-wrap gap-x-8 gap-y-3 rounded-lg border border-line bg-surface px-5 py-4">
          <div><p className="text-sm text-ink-2">Total</p><p className="font-cond text-3xl font-semibold">{rupees(data.totalPaise)}</p></div>
          {cats.slice(0, 6).map(([c, v]) => <div key={c}><p className="text-sm text-ink-2">{c}</p><p className="font-cond text-2xl font-semibold">{rupees(v)}</p></div>)}
        </div>
      )}
      <Panel padded={false}>
        {!data && loading ? <Skeleton /> : data && data.data.length === 0 ? <Empty title={`No expenses in ${r.label}`}>Add rent, salaries and bills as they're paid.</Empty> : data && (
          <Table>
            <thead><tr><Th>Date</Th><Th>Category</Th><Th>Description</Th><Th>Paid by</Th><Th>Branch</Th><Th className="text-right">Amount</Th><Th /></tr></thead>
            <tbody>
              {data.data.map((e) => (
                <tr key={e.id}>
                  <Td className="whitespace-nowrap text-ink-2">{fmtDate(e.expenseDate, true)}</Td>
                  <Td>{e.category}</Td>
                  <Td>{e.description}<div className="text-xs text-ink-3">Added by {e.createdByName}</div></Td>
                  <Td className="text-ink-2">{METHOD[e.paymentMethod]}{e.referenceNumber && <div className="text-xs text-ink-3">{e.referenceNumber}</div>}</Td>
                  <Td className="text-ink-2">{e.branchName}</Td>
                  <Td className="text-right font-medium">{rupees(e.amountPaise, true)}{e.gstPaise > 0 && <div className="text-xs font-normal text-ink-3">incl. GST {rupees(e.gstPaise, true)}</div>}</Td>
                  <Td className="text-right">{can("expenses.manage") && <Button size="sm" variant="ghost" onClick={() => remove(e)}>Delete</Button>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
      {adding && <AddExpense onClose={() => setAdding(false)} onSaved={() => { setAdding(false); setToast("Expense added"); reload(); }} />}
      <Toast message={toast} onDone={() => setToast(null)} />
    </>
  );
}

function AddExpense({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { branches, branchId } = useSession();
  const cats = useApi<{ id: string; name: string }[]>("/expense-categories");
  const [f, setF] = useState({ branchId: branchId || branches[0]?.id || "", categoryId: "", description: "", amount: "", gst: "", expenseDate: istToday(), paymentMethod: "BANK_TRANSFER", referenceNumber: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      await api("/expenses", { body: { branchId: f.branchId, categoryId: f.categoryId || cats.data?.[0]?.id, description: f.description, amountPaise: toPaise(f.amount), gstPaise: f.gst ? toPaise(f.gst) : 0, expenseDate: f.expenseDate, paymentMethod: f.paymentMethod, referenceNumber: f.referenceNumber || undefined } });
      onSaved();
    } catch (e) { setErr(e as ApiError); } finally { setBusy(false); }
  }
  const fe = err?.fieldErrors() ?? {};
  return (
    <Dialog open onClose={onClose} title="Add expense">
      <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        <Select label="Category" value={f.categoryId} onChange={(e) => set("categoryId", e.target.value)} required>
          <option value="">Choose…</option>
          {(cats.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Input type="date" label="Date paid" value={f.expenseDate} max={istToday()} onChange={(e) => set("expenseDate", e.target.value)} required />
        <Input label="What for" wrapClass="sm:col-span-2" placeholder="November rent, EB bill, treadmill belt…" value={f.description} onChange={(e) => set("description", e.target.value)} required error={fe.description} />
        <MoneyInput label="Amount" value={f.amount} onChange={(e) => set("amount", e.target.value)} required error={fe.amountPaise} />
        <MoneyInput label="GST included (optional)" hint="For claiming input credit" value={f.gst} onChange={(e) => set("gst", e.target.value)} />
        <Select label="Paid by" value={f.paymentMethod} onChange={(e) => set("paymentMethod", e.target.value)}>
          {Object.entries(METHOD).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </Select>
        <Input label="Reference (optional)" placeholder="UTR / bill no." value={f.referenceNumber} onChange={(e) => set("referenceNumber", e.target.value)} />
        {branches.length > 1 && (
          <Select label="Branch" value={f.branchId} onChange={(e) => set("branchId", e.target.value)}>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        )}
        <div className="sm:col-span-2"><ErrorNote error={err} /></div>
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" busy={busy}>Add expense</Button>
        </div>
      </form>
    </Dialog>
  );
}
