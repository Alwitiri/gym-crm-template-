"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, ErrorNote, Input, PageHeader, Panel, Select } from "@/components/ui";
import { api, ApiError, PRIVACY_NOTICE_VERSION } from "@/lib/api";
import { useSession } from "@/lib/session";



export default function NewMemberPage() {
  const router = useRouter();
  const { branches, branchId } = useSession();
  const [f, setF] = useState({
    firstName: "", lastName: "", phone: "", email: "", dateOfBirth: "", gender: "", addressLine1: "", city: "Coimbatore", pincode: "",
    eName: "", ePhone: "", eRelation: "", homeBranchId: branchId || branches[0]?.id || "",
  });
  const [marketing, setMarketing] = useState({ MARKETING_WHATSAPP: true, MARKETING_SMS: false, MARKETING_EMAIL: false });
  const [noticeShown, setNoticeShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [dupes, setDupes] = useState<{ id: string; memberCode: string; fullName: string; phoneMasked: string; status: string }[] | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const fe = error?.fieldErrors() ?? {};

  async function submit(confirmNotDuplicate = false) {
    setBusy(true);
    setError(null);
    try {
      const m = await api<{ id: string }>("/members", {
        body: {
          firstName: f.firstName, lastName: f.lastName || undefined, phone: f.phone, email: f.email || undefined,
          dateOfBirth: f.dateOfBirth || undefined, gender: f.gender || undefined, addressLine1: f.addressLine1 || undefined,
          city: f.city || undefined, pincode: f.pincode || undefined, homeBranchId: f.homeBranchId,
          emergencyContact: f.eName || f.ePhone ? { name: f.eName || undefined, phone: f.ePhone || undefined, relation: f.eRelation || undefined } : undefined,
          privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
          marketingConsents: Object.entries(marketing).filter(([, v]) => v).map(([k]) => k),
          confirmNotDuplicate,
        },
      });
      router.push(`/members/${m.id}?sell=1`);
    } catch (e) {
      const err = e as ApiError;
      if (err.code === "POSSIBLE_DUPLICATE") setDupes(err.extra.candidates);
      else setError(err);
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Register member" description="Next you'll choose a membership plan and take payment." />
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="grid gap-6 lg:grid-cols-[1fr_340px]" noValidate>
        <div className="space-y-6">
          <Panel title="About the member">
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="First name" required value={f.firstName} onChange={set("firstName")} error={fe.firstName} autoFocus />
              <Input label="Last name" value={f.lastName} onChange={set("lastName")} />
              <Input label="Mobile number" required type="tel" inputMode="tel" placeholder="98765 43210" value={f.phone} onChange={set("phone")} error={fe.phone} hint="Used for WhatsApp reminders and portal login." />
              <Input label="Email" type="email" value={f.email} onChange={set("email")} error={fe.email} />
              <Input label="Date of birth" type="date" value={f.dateOfBirth} onChange={set("dateOfBirth")} max={new Date().toISOString().slice(0, 10)} />
              <Select label="Gender" value={f.gender} onChange={set("gender")}>
                <option value="">Prefer not to say</option><option value="FEMALE">Female</option><option value="MALE">Male</option><option value="OTHER">Other</option>
              </Select>
              <Input label="Address" wrapClass="sm:col-span-2" value={f.addressLine1} onChange={set("addressLine1")} />
              <Input label="City" value={f.city} onChange={set("city")} />
              <Input label="PIN code" inputMode="numeric" maxLength={6} value={f.pincode} onChange={set("pincode")} error={fe.pincode} />
            </div>
          </Panel>
          <Panel title="Emergency contact">
            <div className="grid gap-4 sm:grid-cols-3">
              <Input label="Name" value={f.eName} onChange={set("eName")} />
              <Input label="Mobile number" type="tel" value={f.ePhone} onChange={set("ePhone")} error={fe["emergencyContact.phone"]} />
              <Input label="Relation" placeholder="Spouse, parent…" value={f.eRelation} onChange={set("eRelation")} />
            </div>
          </Panel>
        </div>

        <div className="space-y-6">
          {branches.length > 1 && (
            <Panel title="Home branch">
              <Select label="Branch" value={f.homeBranchId} onChange={set("homeBranchId")}>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            </Panel>
          )}
          <Panel title="Privacy and messages">
            <p className="text-sm text-ink-2">
              Show the member the privacy notice and confirm they've read it. It explains what we collect, why, and how to ask for it to be corrected or deleted.
            </p>
            <label className="mt-3 flex items-start gap-2.5 text-sm">
              <input type="checkbox" className="mt-0.5 size-4 accent-[var(--ink)]" checked={noticeShown} onChange={(e) => setNoticeShown(e.target.checked)} />
              <span>Member has read privacy notice v{PRIVACY_NOTICE_VERSION}</span>
            </label>
            <fieldset className="mt-4 border-t border-line pt-4">
              <legend className="mb-2 text-sm font-medium text-ink-2">Offers and promotions — only if the member agrees</legend>
              {([["MARKETING_WHATSAPP", "WhatsApp"], ["MARKETING_SMS", "SMS"], ["MARKETING_EMAIL", "Email"]] as const).map(([k, label]) => (
                <label key={k} className="flex items-center gap-2.5 py-1 text-sm">
                  <input type="checkbox" className="size-4 accent-[var(--ink)]" checked={marketing[k]} onChange={(e) => setMarketing({ ...marketing, [k]: e.target.checked })} />
                  {label}
                </label>
              ))}
              <p className="mt-2 text-xs text-ink-3">Receipts and expiry reminders are sent either way.</p>
            </fieldset>
          </Panel>
          <ErrorNote error={error} />
          {dupes && (
            <div role="alert" className="rounded-lg border border-yellow/40 bg-tint-yellow p-4 text-sm">
              <p className="font-semibold">This might be someone already registered</p>
              <ul className="mt-2 space-y-1">
                {dupes.map((d) => <li key={d.id}><Link className="underline" href={`/members/${d.id}`}>{d.fullName}</Link> <span className="text-ink-2">{d.memberCode}, {d.phoneMasked}</span></li>)}
              </ul>
              <Button type="button" variant="secondary" size="sm" className="mt-3" busy={busy} onClick={() => submit(true)}>It's a different person — register anyway</Button>
            </div>
          )}
          <Button type="submit" className="w-full" busy={busy} disabled={!noticeShown || !f.firstName || !f.phone}>Register and choose plan</Button>
        </div>
      </form>
    </>
  );
}
