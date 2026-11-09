"use client";

import { useEffect, useState } from "react";

export interface Brand {
  brandName: string; phone: string; email: string; website: string; privacyNoticeVersion: string;
  branches: { code: string; name: string; city: string; addressLine1: string; phone: string | null }[];
}

const KEY = "gym.brand";
let memo: Brand | null = null;
let inflight: Promise<Brand> | null = null;

function cached(): Brand | null {
  if (memo) return memo;
  try {
    const s = localStorage.getItem(KEY);
    const b = s ? JSON.parse(s) : null;
    if (b && typeof b.brandName === "string" && Array.isArray(b.branches)) memo = b;
  } catch { /* storage unavailable or corrupt */ }
  return memo;
}

/** Business name and contact details from Settings — the only place the gym's name lives. */
export function useBrand(): Brand | null {
  const [brand, setBrand] = useState<Brand | null>(null);
  useEffect(() => {
    const c = cached();
    if (c) setBrand(c);
    inflight ??= fetch("/api/v1/public/branding").then(async (r) => {
      const b = await r.json();
      if (!r.ok || typeof b?.brandName !== "string") throw new Error("branding unavailable");
      return { ...b, branches: Array.isArray(b.branches) ? b.branches : [] } as Brand;
    });
    inflight.then((b) => {
      memo = b;
      try { localStorage.setItem(KEY, JSON.stringify(b)); } catch { /* ignore */ }
      setBrand(b);
    }).catch(() => { inflight = null; });
  }, []);
  return brand;
}

/** Call after Settings are saved so every screen picks up the new name. */
export function forgetBrand() {
  memo = null; inflight = null;
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
