"use client";

import { useParams } from "next/navigation";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { Button, ErrorNote, Skeleton } from "@/components/ui";
import { api, fmtDate } from "@/lib/api";
import { useBrand } from "@/lib/brand";
import { useApi, useSession } from "@/lib/session";

interface Member {
  id: string; fullName: string; memberCode: string; qrToken?: string; homeBranch: { name: string }; joinedOn: string;
  currentSubscription: { planName: string; endDate: string } | null;
}

/** Credit-card sized membership card (85.6 × 54 mm) with the member's check-in QR. */
export default function CardPage() {
  const brand = useBrand();
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const { data: m, error, reload } = useApi<Member>(`/members/${id}`);
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (m?.qrToken) QRCode.toDataURL(m.qrToken, { margin: 1, width: 360, errorCorrectionLevel: "M" }).then(setQr);
  }, [m?.qrToken]);

  async function reissue() {
    if (!window.confirm("Issue a new card? The old card's QR code will stop working straight away.")) return;
    setBusy(true);
    try { await api(`/members/${id}/credential/rotate`, { body: {} }); reload(); } finally { setBusy(false); }
  }

  if (error) return <ErrorNote error={error} />;
  if (!m) return <Skeleton rows={4} />;
  if (!m.qrToken) return <p>You don't have permission to print membership cards.</p>;

  return (
    <>
      <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl">Membership card</h1>
          <p className="text-ink-2">Print on card stock, or send the member a photo of it. They scan the QR at the front desk.</p>
        </div>
        <div className="flex gap-2">
          {can("members.credential.rotate") && <Button variant="secondary" busy={busy} onClick={reissue}>Card lost? Issue new one</Button>}
          <Button onClick={() => window.print()}>Print</Button>
        </div>
      </div>
      <div className="flex justify-center">
        <article
          className="relative flex overflow-hidden rounded-[3.2mm] bg-[#1b2430] text-white shadow-xl print:shadow-none"
          style={{ width: "85.6mm", height: "54mm", printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }}
        >
          <span className="absolute inset-y-0 left-0 w-[2.2mm] bg-[#c22a32]" aria-hidden />
          <div className="flex flex-1 flex-col justify-between py-[4mm] pl-[6mm] pr-[2mm]">
            <div>
              <p className="font-cond text-[13pt] font-semibold leading-none">{brand?.brandName}</p>
              <p className="mt-[0.8mm] text-[6.5pt] text-[#aab5c2]">{m.homeBranch.name}, Coimbatore</p>
            </div>
            <div>
              <p className="font-cond text-[15pt] font-semibold leading-tight">{m.fullName}</p>
              <p className="text-[7.5pt] tracking-wide text-[#c9d2dc]">{m.memberCode}</p>
              <p className="mt-[1mm] text-[6.5pt] text-[#aab5c2]">
                {m.currentSubscription ? `${m.currentSubscription.planName}, valid to ${fmtDate(m.currentSubscription.endDate)}` : `Member since ${fmtDate(m.joinedOn)}`}
              </p>
            </div>
          </div>
          <div className="flex items-center pr-[4mm]">
            <div className="rounded-[1.5mm] bg-white p-[1.2mm]">
              {qr ? <img src={qr} alt={`Check-in QR code for ${m.fullName}`} style={{ width: "27mm", height: "27mm" }} /> : <div style={{ width: "27mm", height: "27mm" }} />}
            </div>
          </div>
        </article>
      </div>
      <p className="no-print mt-6 text-center text-sm text-ink-3">Keep this card private. Anyone with the QR can check in as this member until a new card is issued.</p>
    </>
  );
}
