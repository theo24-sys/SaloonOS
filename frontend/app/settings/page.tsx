"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { api, Catalog, store } from "@/lib/api";
import { Receipt, THEMES, Accent } from "@/app/receipt";

export default function Settings() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [pin, setPin] = useState(store.pin);
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const [tagline, setTagline] = useState("");
  const [phone, setPhone] = useState("");
  const [location, setLocation] = useState("");
  const [accent, setAccent] = useState<Accent>("blush");
  const [thankYou, setThankYou] = useState("");
  const [logo, setLogo] = useState("");

  useEffect(() => {
    api.catalog(store.slug).then((c) => {
      setCatalog(c);
      const b = c.business as unknown as Catalog["business"] & {
        tagline: string; phone: string; location: string; accent: Accent; thank_you: string;
      };
      setTagline(b.tagline || "");
      setPhone(b.phone || "");
      setLocation(b.location || "");
      setAccent(b.accent || "blush");
      setThankYou(b.thank_you || "");
      setLogo(b.logo_data_url || "");
    }).catch((e) => setErr(e.message));
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(""); setSaved(false); setBusy(true);
    try {
      await api.branding(store.slug, pin, { tagline, phone, location, accent, thank_you: thankYou, logo_data_url: logo });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const previewBranding = {
    name: catalog?.business.name || "Your Salon", tagline, phone, location, accent, thank_you: thankYou,
  };
  const previewBill = {
    code: "SV48291", customer_name: "Mary Wanjiku", staff_name: "Jane", status: "paid",
    total: 3600, payment_method: "M-Pesa",
    created_at: new Date().toISOString(), approved_at: new Date().toISOString(),
    items: [
      { id: 1, name: "Braiding", price: 2500 },
      { id: 2, name: "Hair Treatment", price: 800 },
      { id: 3, name: "Hair Wash", price: 300 },
    ],
  };

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <div className="flex items-center justify-between">
        <div>
          <label className="text-sm font-semibold text-dim">Salon logo</label>
          <div className="mt-2 flex items-center gap-3">
            {logo ? (
              <Image src={logo} alt="Salon logo preview" width={56} height={56} unoptimized className="h-14 w-14 rounded-xl border border-line object-cover" />
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-dashed border-line text-xs text-dim">No logo</div>
            )}
            <label className="cursor-pointer rounded-xl border border-line bg-surface2 px-3 py-2 text-xs font-semibold hover:border-brand">
              Upload image
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (file.size > 500_000) {
                    setErr("Logo must be smaller than 500 KB");
                    return;
                  }
                  const reader = new FileReader();
                  reader.onload = () => setLogo(String(reader.result));
                  reader.readAsDataURL(file);
                }}
              />
            </label>
            {logo && <button type="button" onClick={() => setLogo("")} className="text-xs font-semibold text-bad">Remove</button>}
          </div>
          <p className="mt-1 text-xs text-dim">PNG, JPG or WebP · max 500 KB · shown on customer receipts</p>
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold">Appearance</h1>
          <p className="text-sm text-dim">Make receipts feel like your salon&apos;s — the verified stamp stays ours.</p>
        </div>
        <Link href="/owner" className="shrink-0 whitespace-nowrap rounded-xl border border-line bg-surface px-3 py-1.5 text-sm font-semibold text-dim">← Dashboard</Link>
      </div>

      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <form onSubmit={save} className="card space-y-4 p-5">
          <div>
            <label className="text-sm font-semibold text-dim">Receipt theme</label>
            <div className="mt-2 grid grid-cols-5 gap-2">
              {(Object.keys(THEMES) as Accent[]).map((k) => (
                <button
                  type="button"
                  key={k}
                  onClick={() => setAccent(k)}
                  title={THEMES[k].label}
                  className={`h-12 rounded-xl border-2 transition ${accent === k ? "scale-105 border-plum" : "border-transparent"}`}
                  style={{ background: THEMES[k].swatch }}
                />
              ))}
            </div>
            <p className="mt-1 text-xs text-dim">{THEMES[accent].label}</p>
          </div>

          <div>
            <label className="text-sm font-semibold text-dim">Tagline</label>
            <input value={tagline} onChange={(e) => setTagline(e.target.value.slice(0, 120))}
              placeholder="Braids · Nails · Beauty"
              className="mt-1 w-full rounded-xl border border-line bg-surface2 px-3 py-2.5 text-sm outline-none focus:border-brand" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-semibold text-dim">Phone</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value.slice(0, 20))}
                placeholder="0712 345 678"
                className="mt-1 w-full rounded-xl border border-line bg-surface2 px-3 py-2.5 text-sm outline-none focus:border-brand" />
            </div>
            <div>
              <label className="text-sm font-semibold text-dim">Location</label>
              <input value={location} onChange={(e) => setLocation(e.target.value.slice(0, 120))}
                placeholder="Kimathi Street, Nairobi"
                className="mt-1 w-full rounded-xl border border-line bg-surface2 px-3 py-2.5 text-sm outline-none focus:border-brand" />
            </div>
          </div>

          <div>
            <label className="text-sm font-semibold text-dim">
              Thank-you message <span className="text-xs">({thankYou.length}/150)</span>
            </label>
            <textarea value={thankYou} onChange={(e) => setThankYou(e.target.value.slice(0, 150))}
              rows={2}
              placeholder="Thank you for choosing us ♡"
              className="mt-1 w-full resize-none rounded-xl border border-line bg-surface2 px-3 py-2.5 text-sm outline-none focus:border-brand" />
          </div>

          <div>
            <label className="text-sm font-semibold text-dim">Owner PIN</label>
            <input value={pin} onChange={(e) => setPin(e.target.value)} type="password" inputMode="numeric"
              placeholder="••••"
              className="mt-1 w-full rounded-xl border border-line bg-surface2 px-3 py-2.5 text-sm tracking-widest outline-none focus:border-brand" />
          </div>

          {err && <p className="text-sm text-bad">{err}</p>}
          {saved && <p className="text-sm text-good">✓ Saved — receipts now use this look</p>}
          <button disabled={busy}
            className="w-full rounded-xl bg-plum px-4 py-3 font-bold text-white disabled:opacity-50">
            {busy ? "Saving…" : "Save appearance"}
          </button>
        </form>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.25em] text-dim">Live preview</p>
          <Receipt branding={previewBranding} bill={previewBill} variant="receipt" />
          <p className="mt-3 text-[11px] leading-relaxed text-dim">
            The customer-verified stamp, total and staff name can&apos;t be hidden — that&apos;s the trust
            the whole product is built on.
          </p>
        </div>
      </div>
    </main>
  );
}
