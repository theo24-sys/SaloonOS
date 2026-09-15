"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";

function SignupInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [planCode, setPlanCode] = useState("growth");
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const p = params.get("plan");
    if (p) setPlanCode(p);
  }, [params]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const biz = await api.signup({ name, phone, plan_code: planCode, owner_pin: pin });
      localStorage.setItem("sp_slug", biz.slug);
      localStorage.setItem("sp_pin", pin);
      router.push("/owner");
    } catch (e2) {
      setErr((e2 as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto grid max-w-5xl gap-12 px-[18px] py-14 sm:px-6 sm:py-20 lg:grid-cols-[.8fr_1.2fr] lg:items-center">
      <div><div className="eyebrow">Your first step to calmer books</div><h1 className="mt-4 font-display text-5xl font-semibold leading-[.98] tracking-[-.045em] sm:text-6xl">Open your <em>salon&apos;s</em> control room.</h1><p className="mt-5 max-w-md text-base leading-7 text-dim">Set up your business once. Then send your team to work with bills, QR verification and receipts already in place.</p><div className="mt-8 space-y-4 text-sm"><div className="flex gap-3"><span className="check-icon shrink-0">✓</span><span><strong className="text-ink">Full access for 7 days.</strong><br /><span className="text-dim">Explore the owner dashboard before you commit.</span></span></div><div className="flex gap-3"><span className="check-icon shrink-0">✓</span><span><strong className="text-ink">No card, no hidden setup.</strong><br /><span className="text-dim">Choose a plan now, pay only when you&apos;re ready.</span></span></div></div></div>

      <form onSubmit={submit} className="rounded-2xl border border-line bg-white/85 p-6 shadow-[0_22px_50px_-32px_rgba(76,41,72,.55)] sm:p-8">
        <div className="flex items-center justify-between"><div><div className="text-xs font-extrabold uppercase tracking-[.14em] text-brand2">01 / 02</div><h2 className="mt-2 font-display text-2xl font-semibold">Create your workspace</h2></div><div className="rounded-full bg-surface2 px-3 py-1.5 text-[11px] font-bold text-dim">7-day free trial</div></div>
        <div className="mt-7 space-y-5">
        <div>
          <label className="text-sm font-semibold text-dim">Salon / barber name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. XYZ Salon"
            className="mt-2 w-full rounded-xl border border-line bg-bg px-4 py-3 outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10"
            required
          />
        </div>
        <div>
          <label className="text-sm font-semibold text-dim">Plan</label>
          <select
            value={planCode}
            onChange={(e) => setPlanCode(e.target.value)}
            className="mt-2 w-full rounded-xl border border-line bg-bg px-4 py-3 outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10"
          >
            <option value="starter">Starter — KSh 299/mo</option>
            <option value="growth">Growth ⭐ — KSh 499/mo</option>
            <option value="business">Business — KSh 799/mo</option>
            <option value="pro">Pro — KSh 1,299/mo</option>
          </select>
        </div>
        <div>
          <label className="text-sm font-semibold text-dim">Owner phone number</label>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="e.g. 0712 345 678"
            className="mt-2 w-full rounded-xl border border-line bg-bg px-4 py-3 outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10"
            required
          />
          <p className="mt-1 text-xs text-dim">Used to sign in and receive account updates.</p>
        </div>
        <div>
          <label className="text-sm font-semibold text-dim">Owner dashboard PIN (4+ digits)</label>
          <input
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
            inputMode="numeric"
            placeholder="e.g. 2026"
            className="mt-2 w-full rounded-xl border border-line bg-bg px-4 py-3 tracking-[.3em] outline-none focus:border-brand focus:ring-4 focus:ring-brand/10"
            required
            minLength={4}
          />
        </div></div>
        {err && <p className="text-sm text-bad">{err}</p>}
        <button
          disabled={busy}
          className="mt-7 w-full rounded-full bg-plum px-4 py-3.5 font-extrabold text-white shadow-[0_14px_24px_-16px_rgba(76,41,72,.8)] transition hover:-translate-y-0.5 hover:bg-[#382039] disabled:opacity-50"
        >
          {busy ? "Creating…" : "Create my business"}
        </button>
      </form>
      <p className="mt-4 text-center text-[11px] leading-5 text-dim">
        After setup, you&apos;ll go straight to your owner dashboard. Staff join using invite links.
      </p>
    </main>
  );
}

export default function Signup() {
  return (
    <Suspense>
      <SignupInner />
    </Suspense>
  );
}
