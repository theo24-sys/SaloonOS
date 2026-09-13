"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, money, Plan } from "@/lib/api";

export default function Pricing() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [annual, setAnnual] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    api.plans().then(setPlans).catch((e) => setErr(e.message));
  }, []);

  return (
    <main className="mx-auto max-w-6xl px-[18px] py-14 sm:px-6 sm:py-20">
      <div className="mx-auto max-w-3xl text-center">
      <div className="eyebrow">Simple, honest pricing</div>
      <h1 className="mt-4 font-display text-5xl font-semibold leading-[.98] tracking-[-.045em] sm:text-6xl">Pick the pace that fits your <em>chair count.</em></h1>
      <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-dim">
        Basic trust is never crippled: every plan includes full customer QR verification.
        You pay for scale and management, not honesty.
      </p>

      <div className="mt-7 inline-flex rounded-full border border-line bg-white/60 p-1 text-sm font-bold shadow-sm">
        <button
          onClick={() => setAnnual(false)}
          className={`rounded-full px-5 py-2 transition ${!annual ? "bg-plum text-white" : "text-dim hover:text-ink"}`}
        >
          Monthly
        </button>
        <button
          onClick={() => setAnnual(true)}
          className={`rounded-full px-5 py-2 transition ${annual ? "bg-plum text-white" : "text-dim hover:text-ink"}`}
        >
          Annual · 2 months free
        </button>
      </div></div>

      {err && <p className="mt-4 text-bad">{err}</p>}

      <div className="mt-12 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {plans.map((p) => (
          <div
            key={p.code}
            className={`relative flex flex-col rounded-2xl border bg-white/80 p-6 shadow-[0_14px_35px_-28px_rgba(76,41,72,.5)] transition hover:-translate-y-1 ${
              p.is_target ? "border-brand ring-1 ring-brand/15" : "border-line"
            }`}
          >
            {p.is_target && (
              <div className="absolute -top-2.5 left-5 rounded-full bg-plum px-2.5 py-0.5 text-xs font-bold text-white">
                Most popular
              </div>
            )}
            <div className="text-xs font-extrabold uppercase tracking-[.14em] text-brand2">{p.name}</div>
            <div className="mt-2 min-h-10 text-sm text-dim">{p.tagline}</div>
            <div className="mt-5 font-display text-4xl font-semibold tracking-[-.04em]">
              {money(annual ? p.price_annual : p.price_monthly)}
              <span className="text-sm font-semibold text-dim">/{annual ? "yr" : "mo"}</span>
            </div>
            <div className="mt-2 rounded-lg bg-surface2 px-3 py-2 text-xs font-semibold text-ink">
              {p.monthly_verified_bills.toLocaleString()} verified bills/mo · {p.max_staff >= 20 ? "20+ staff" : `${p.max_staff} staff`}
            </div>
            <ul className="mt-5 flex-1 space-y-2.5 text-sm text-dim">
              {p.features.map((f) => (
                <li key={f} className="flex gap-2">
                  <span className="text-brand">✓</span> {f}
                </li>
              ))}
            </ul>
            <Link
              href={`/signup?plan=${p.code}`}
              className={`mt-7 block rounded-full px-4 py-3 text-center text-sm font-extrabold transition hover:-translate-y-0.5 ${
                p.is_target ? "bg-plum text-white hover:bg-[#382039]" : "border border-line2 bg-surface2 text-ink hover:border-brand"
              }`}
            >               Start 7 days free
            </Link>
          </div>
        ))}
      </div>

      <p className="mx-auto mt-10 max-w-2xl rounded-xl border border-line bg-white/50 p-4 text-center text-sm text-dim">         <span className="font-bold text-ink">No card required.</span> Experience the full loop:
        service → bill → QR → customer verifies → payment → receipt.
      </p>
    </main>
  );
}
