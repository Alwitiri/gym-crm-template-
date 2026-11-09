"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Button, ErrorNote, Panel, Skeleton, Status } from "@/components/ui";
import { fmtDate, fmtDateTime, rupees } from "@/lib/api";
import { useApi } from "@/lib/session";
import { PaymentLinkButton } from "@/components/billing-dialogs";

interface Invoice {
  id: string; invoiceNumber: string; status: string; issueDate: string; placeOfSupplyStateCode: string;
  subtotalPaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number; roundOffPaise: number; totalPaise: number; paidPaise: number; duePaise: number;
  items: { id: string; description: string; sacOrHsn: string | null; quantity: number; unitPricePaise: number; discountPaise: number; taxableValuePaise: number; taxRateBp: number; taxPaise: number; totalPaise: number }[];
  allocations: { id: string; amountPaise: number; payment: { receiptNumber: string; method: string; receivedAt: string } }[];
  member: { firstName: string; lastName: string | null; memberCode: string; phone: string };
  branch: { name: string; addressLine1: string; city: string; state: string; stateCode: string; pincode: string; phone: string | null; gstin: string | null };
  business: { legalName: string; brandName: string; gstin: string | null } | null;
  memberId: string;
}

/** Rupees in words, Indian numbering (lakh/crore), for the invoice total. */
function inWords(paise: number) {
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const two = (n: number) => (n < 20 ? ones[n] : `${tens[Math.floor(n / 10)]}${n % 10 ? " " + ones[n % 10] : ""}`);
  const three = (n: number) => (n >= 100 ? `${ones[Math.floor(n / 100)]} Hundred${n % 100 ? " " + two(n % 100) : ""}` : two(n));
  let r = Math.floor(paise / 100);
  if (r === 0) return "Zero rupees only";
  const parts: string[] = [];
  const crore = Math.floor(r / 1e7); r %= 1e7;
  const lakh = Math.floor(r / 1e5); r %= 1e5;
  const thousand = Math.floor(r / 1000); r %= 1000;
  if (crore) parts.push(`${two(crore)} Crore`);
  if (lakh) parts.push(`${two(lakh)} Lakh`);
  if (thousand) parts.push(`${two(thousand)} Thousand`);
  if (r) parts.push(three(r));
  return `Rupees ${parts.join(" ")} only`;
}

export default function InvoicePage() {
  const { id } = useParams<{ id: string }>();
  const { data: inv, error } = useApi<Invoice>(`/invoices/${id}`);
  if (error) return <ErrorNote error={error} />;
  if (!inv) return <Panel><Skeleton rows={8} /></Panel>;
  const gstin = inv.branch.gstin ?? inv.business?.gstin;
  const rate = inv.items[0]?.taxRateBp ?? 1800;

  return (
    <>
      <div className="no-print mb-4 flex items-center justify-between">
        <Link href={`/members/${inv.memberId}`} className="text-sm text-ink-2 hover:underline">Back to {inv.member.firstName}</Link>
        <div className="flex gap-2">
          {inv.duePaise > 0 && ["ISSUED", "PARTIALLY_PAID"].includes(inv.status) && <PaymentLinkButton invoiceId={inv.id} size="md" />}
          <Button variant="secondary" onClick={() => window.print()}>Print or save as PDF</Button>
        </div>
      </div>
      <article className="mx-auto max-w-3xl rounded-lg border border-line bg-surface p-8 print:max-w-none print:border-0 print:p-0">
        <header className="flex flex-wrap justify-between gap-6 border-b-2 border-ink pb-5">
          <div>
            <p className="font-cond text-3xl font-semibold">{inv.business?.brandName}</p>
            <p className="text-sm text-ink-2">{inv.business?.legalName}</p>
            <p className="mt-2 text-sm text-ink-2">{inv.branch.addressLine1}, {inv.branch.city} {inv.branch.pincode}<br />{inv.branch.state} (state code {inv.branch.stateCode}){inv.branch.phone ? `, ${inv.branch.phone}` : ""}</p>
            {gstin && <p className="mt-1 text-sm">GSTIN <strong>{gstin}</strong></p>}
          </div>
          <div className="text-right">
            <h1 className="text-2xl">Tax invoice</h1>
            <p className="mt-1 font-medium">{inv.invoiceNumber}</p>
            <p className="text-sm text-ink-2">{fmtDate(inv.issueDate)}</p>
            <div className="no-print mt-2"><Status value={inv.status} /></div>
          </div>
        </header>

        <section className="grid gap-4 py-5 text-sm sm:grid-cols-2">
          <div>
            <p className="text-ink-3">Billed to</p>
            <p className="font-medium">{[inv.member.firstName, inv.member.lastName].filter(Boolean).join(" ")}</p>
            <p className="text-ink-2">Member {inv.member.memberCode}, {inv.member.phone}</p>
          </div>
          <div className="sm:text-right">
            <p className="text-ink-3">Place of supply</p>
            <p>{inv.branch.state} ({inv.placeOfSupplyStateCode})</p>
          </div>
        </section>

        <table className="w-full text-sm">
          <thead>
            <tr className="border-y border-line text-left text-ink-3">
              <th className="py-2 font-medium">Description</th><th className="py-2 font-medium">SAC</th>
              <th className="py-2 text-right font-medium">Rate</th><th className="py-2 text-right font-medium">Discount</th><th className="py-2 text-right font-medium">Taxable value</th>
            </tr>
          </thead>
          <tbody>
            {inv.items.map((i) => (
              <tr key={i.id} className="border-b border-line">
                <td className="py-2.5 pr-3">{i.description}</td>
                <td className="py-2.5">{i.sacOrHsn}</td>
                <td className="py-2.5 text-right">{rupees(i.unitPricePaise, true)}</td>
                <td className="py-2.5 text-right">{i.discountPaise ? rupees(i.discountPaise, true) : "—"}</td>
                <td className="py-2.5 text-right">{rupees(i.taxableValuePaise, true)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="ml-auto mt-4 w-full max-w-xs space-y-1.5 text-sm">
          <Row k="Taxable value" v={rupees(inv.subtotalPaise, true)} />
          {inv.igstPaise ? <Row k={`IGST ${rate / 100}%`} v={rupees(inv.igstPaise, true)} /> : (
            <>
              <Row k={`CGST ${rate / 200}%`} v={rupees(inv.cgstPaise, true)} />
              <Row k={`SGST ${rate / 200}%`} v={rupees(inv.sgstPaise, true)} />
            </>
          )}
          {inv.roundOffPaise !== 0 && <Row k="Round off" v={rupees(inv.roundOffPaise, true)} />}
          <div className="flex justify-between border-t-2 border-ink pt-2 text-base font-semibold"><span>Total</span><span>{rupees(inv.totalPaise, true)}</span></div>
        </div>
        <p className="mt-2 text-right text-xs text-ink-2">{inWords(inv.totalPaise)}</p>

        <section className="mt-8 border-t border-line pt-4 text-sm">
          <p className="mb-2 font-medium">Payments received</p>
          {inv.allocations.length === 0 ? <p className="text-ink-3">None yet.</p> : (
            <ul className="space-y-1">
              {inv.allocations.map((a) => (
                <li key={a.id} className="flex justify-between"><span>{a.payment.receiptNumber}, {a.payment.method.replace("_", " ").toLowerCase()}, {fmtDateTime(a.payment.receivedAt)}</span><span>{rupees(a.amountPaise, true)}</span></li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex justify-between font-semibold"><span>Balance due</span><span className={inv.duePaise ? "text-red" : ""}>{rupees(inv.duePaise, true)}</span></div>
        </section>
        <p className="mt-10 text-xs text-ink-3">This is a computer-generated invoice and does not need a signature.</p>
      </article>
    </>
  );
}

const Row = ({ k, v }: { k: string; v: string }) => <div className="flex justify-between"><span className="text-ink-2">{k}</span><span>{v}</span></div>;
