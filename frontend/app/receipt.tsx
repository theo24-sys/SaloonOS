"use client";

import { money } from "@/lib/api";

/* ---------- Receipt themes (owner picks one; trust elements stay fixed) ---------- */

export type Accent = "blush" | "rose" | "luxe" | "plum" | "minimal";

type Theme = {
  label: string;
  swatch: string; // preview swatch gradient
  card: string; // receipt background
  panel: string; // header panel
  ink: string;
  dim: string;
  line: string;
  accent: string;
  chip: string; // verified stamp
};

export const THEMES: Record<Accent, Theme> = {
  blush: {
    label: "01 — Blush", swatch: "linear-gradient(135deg,#fff5f3,#f6d9de)",
    card: "bg-white", panel: "bg-gradient-to-b from-[#fff5f3] to-[#fdeef0]",
    ink: "text-[#3d3140]", dim: "text-[#a08e96]", line: "border-[#f3e2dd]",
    accent: "text-[#c25e7c]", chip: "border-[#c25e7c] text-[#c25e7c] bg-[#fdf1ee]",
  },
  rose: {
    label: "02 — Rose", swatch: "linear-gradient(135deg,#f6d9de,#a94f6b)",
    card: "bg-white", panel: "bg-[#f6dde2]",
    ink: "text-[#43222e]", dim: "text-[#a07f88]", line: "border-[#f2d8dd]",
    accent: "text-[#a94f6b]", chip: "border-[#a94f6b] text-[#a94f6b] bg-[#fbe9ee]",
  },
  luxe: {
    label: "03 — Luxe", swatch: "linear-gradient(135deg,#1f1b1a,#cfa66b)",
    card: "bg-[#211c1a] text-[#f5efe6]", panel: "bg-gradient-to-b from-[#2a2422] to-[#211c1a]",
    ink: "text-[#f5efe6]", dim: "text-[#b3a694]", line: "border-[#3a322e]",
    accent: "text-[#cfa66b]", chip: "border-[#cfa66b] text-[#cfa66b] bg-[#2a2422]",
  },
  plum: {
    label: "04 — Plum", swatch: "linear-gradient(135deg,#4a2d44,#e3b7cd)",
    card: "bg-white", panel: "bg-[#efe1ea]",
    ink: "text-[#43253c]", dim: "text-[#9b8394]", line: "border-[#e8d6e1]",
    accent: "text-[#6d4260]", chip: "border-[#6d4260] text-[#6d4260] bg-[#f4e8ef]",
  },
  minimal: {
    label: "05 — Minimal", swatch: "linear-gradient(135deg,#ffffff,#e8e4e1)",
    card: "bg-white", panel: "bg-white",
    ink: "text-[#2b2725]", dim: "text-[#9c938d]", line: "border-[#eee9e6]",
    accent: "text-[#2b2725]", chip: "border-[#2b2725] text-[#2b2725] bg-white",
  },
};

export type Branding = {
  name: string; tagline: string; phone: string; location: string;
  accent: string; thank_you: string;
};

export type ReceiptBill = {
  code: string; customer_name: string; staff_name: string; status: string;
  total: number; payment_method: string; created_at: string; approved_at: string | null;
  items: { id?: number; name: string; price: number }[];
};

const STATUS_LABEL: Record<string, string> = {
  pending: "PENDING VERIFICATION", approved: "✓ VERIFIED", paid: "✓ VERIFIED · PAID",
  disputed: "⚠ DISPUTED", voided: "🚫 VOIDED", refunded: "↩ REFUNDED", draft: "DRAFT",
};

export function Badge({ status }: { status: string }) {
  const s: Record<string, string> = {
    pending: "bg-[#f7e8d8] text-warn",
    approved: "bg-[#e7f0ea] text-good",
    paid: "bg-[#ece7f6] text-info",
    disputed: "bg-[#f8e4e1] text-bad",
    voided: "bg-[#f8e4e1] text-bad line-through",
    draft: "bg-surface2 text-dim",
    refunded: "bg-surface2 text-dim",
  };
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${s[status] ?? s.draft}`}>
      {status}
    </span>
  );
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("en-KE", {
    day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
  });

export function Receipt({
  branding, bill, variant = "receipt",
}: {
  branding: Branding;
  bill: ReceiptBill;
  variant?: "verify" | "receipt" | "public";
}) {
  const t = THEMES[(branding.accent as Accent) in THEMES ? (branding.accent as Accent) : "blush"];
  const verified = bill.status === "approved" || bill.status === "paid" ||
    bill.status === "refunded";

  return (
    <div className={`overflow-hidden rounded-3xl border ${t.line} shadow-[0_20px_50px_-24px_rgba(93,58,88,0.35)]`}>
      {/* Header */}
      <div className={`${t.panel} px-6 pb-5 pt-7 text-center`}>
        <div className={`text-2xl ${t.accent}`}>✦</div>
        <h1 className={`font-display mt-1 text-2xl font-bold uppercase leading-tight tracking-[0.08em] ${t.ink}`}>
          {branding.name}
        </h1>
        {branding.tagline && <p className={`mt-1 text-xs uppercase tracking-[0.2em] ${t.dim}`}>{branding.tagline}</p>}
        {(branding.phone || branding.location) && (
          <p className={`mt-1 text-xs ${t.dim}`}>
            {[branding.phone, branding.location].filter(Boolean).join(" · ")}
          </p>
        )}
        <p className={`mt-3 text-[11px] font-semibold uppercase tracking-[0.25em] ${t.dim}`}>
          {variant === "verify" ? "Your visit today" : "Service receipt"}
        </p>
      </div>

      {/* Body */}
      <div className={`${t.card} px-6 py-5 ${t.ink}`}>
        <div className="flex items-baseline justify-between">
          <div>
            <div className={`text-[11px] uppercase tracking-widest ${t.dim}`}>Customer</div>
            <div className="font-semibold">{bill.customer_name}</div>
          </div>
          <div className={`text-right text-xs ${t.dim}`}>
            {fmtDate(bill.created_at)}
            <div>with {bill.staff_name}</div>
          </div>
        </div>

        <div className={`my-4 border-t border-dashed ${t.line}`} />

        <div className="space-y-2.5">
          {bill.items.map((i) => (
            <div key={i.id ?? i.name} className="flex items-baseline justify-between text-[15px]">
              <span>{i.name}</span>
              <span className="font-semibold tabular-nums">{money(i.price)}</span>
            </div>
          ))}
        </div>

        <div className={`my-4 border-t border-dashed ${t.line}`} />

        <div className="flex items-baseline justify-between">
          <span className={`text-[11px] font-semibold uppercase tracking-[0.3em] ${t.dim}`}>Total</span>
          <span className={`font-display text-3xl font-bold tabular-nums ${t.ink}`}>{money(bill.total)}</span>
        </div>

        {/* Trust block — platform controlled, cannot be removed by branding */}
        <div className="mt-6 text-center">
          {verified ? (
            <>
              <div className={`mx-auto w-fit rounded-full border px-5 py-1.5 text-xs font-bold uppercase tracking-[0.2em] ${t.chip}`}>
                ✓ Customer verified
              </div>
              {bill.approved_at && (
                <p className={`mt-2 text-[11px] ${t.dim}`}>
                  Confirmed by {bill.customer_name} · {fmtDate(bill.approved_at)}
                </p>
              )}
              {bill.status === "paid" && bill.payment_method && (
                <p className={`mt-1 text-xs font-semibold ${t.accent}`}>Paid · {bill.payment_method}</p>
              )}
              {variant !== "verify" && branding.thank_you && (
                <p className={`mt-4 text-sm italic ${t.dim}`}>{branding.thank_you}</p>
              )}
              <p className={`mt-3 font-mono text-[11px] tracking-wider ${t.dim}`}>
                Receipt №{bill.code} · verify at /r/{bill.code}
              </p>
            </>
          ) : (
            <div className={`mx-auto w-fit rounded-full border px-5 py-1.5 text-xs font-bold uppercase tracking-[0.2em] ${t.chip}`}>
              {STATUS_LABEL[bill.status] ?? bill.status}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
