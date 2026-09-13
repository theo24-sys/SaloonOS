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
    <main className="mx-auto max-w-2xl px-5 py-10">
      <h1 className="font-display text-3xl font-bold">Simple pricing, in KSh</h1>
      <p className="mt-2 text-dim">
        Basic trust is never crippled: every plan includes full customer QR verification.
        You pay for scale and management, not honesty.
      </p>

      <div className="mt-5 flex items-center gap-3 text-sm font-semibold">
        <button
          onClick={() => setAnnual(false)}
          className={`rounded-full px-4 py-1.5 ${!annual ? "bg-plum text-white" : "border border-line bg-surface text-dim"}`}
        >
          Monthly
        </button>
        <button
          onClick={() => setAnnual(true)}
          className={`rounded-full px-4 py-1.5 ${annual ? "bg-plum text-white" : "border border-line bg-surface text-dim"}`}
        >
          Annual · 2 months free
        </button>
      </div>

      {err && <p className="mt-4 text-bad">{err}</p>}

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        {plans.map((p) => (
          <div
            key={p.code}
            className={`relative rounded-2xl border bg-surface p-5 ${
              p.is_target ? "border-brand" : "border-line"
            }`}
          >
            {p.is_target && (
              <div className="absolute -top-2.5 left-5 rounded-full bg-plum px-2.5 py-0.5 text-xs font-bold text-white">
                ⭐ Most popular
              </div>
            )}
            <div className="font-extrabold">{p.name}</div>
            <div className="text-xs text-dim">{p.tagline}</div>
            <div className="mt-3 text-2xl font-extrabold">
              {money(annual ? p.price_annual : p.price_monthly)}
              <span className="text-sm font-semibold text-dim">/{annual ? "yr" : "mo"}</span>
            </div>
            <div className="mt-1 text-xs text-dim">
              {p.monthly_verified_bills.toLocaleString()} verified bills/mo · {p.max_staff >= 20 ? "20+ staff" : `${p.max_staff} staff`}
            </div>
            <ul className="mt-3 space-y-1 text-sm">
              {p.features.map((f) => (
                <li key={f} className="flex gap-2">
                  <span className="text-brand">✓</span> {f}
                </li>
              ))}
            </ul>
            <Link
              href={`/signup?plan=${p.code}`}
              className={`mt-4 block rounded-xl px-4 py-2.5 text-center font-bold ${
                p.is_target ? "bg-plum text-white" : "border border-line bg-surface2 hover:border-dim"
              }`}
            >               Start 7 days free
            </Link>
          </div>
        ))}
      </div>

      <p className="mt-6 text-center text-sm text-dim">         7-day free trial — no card required. Experience the full loop:
        service → bill → QR → customer verifies → payment → receipt.
      </p>
    </main>
  );
}
