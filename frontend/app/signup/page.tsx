"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";

function SignupInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [name, setName] = useState("");
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
      const biz = await api.signup({ name, plan_code: planCode, owner_pin: pin });
      localStorage.setItem("sp_slug", biz.slug);
      localStorage.setItem("sp_pin", pin);
      router.push("/app");
    } catch (e2) {
      setErr((e2 as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-md px-5 py-10">
      <h1 className="font-display text-2xl font-bold">Start your 14-day free trial</h1>
      <p className="mt-1 text-sm text-dim">No card required. Cancel anytime.</p>

      <form onSubmit={submit} className="mt-6 space-y-4 rounded-2xl border border-line bg-surface p-5">
        <div>
          <label className="text-sm font-semibold text-dim">Salon / barber name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. XYZ Salon"
            className="mt-1 w-full rounded-xl border border-line bg-surface2 px-3 py-2.5 outline-none focus:border-brand"
            required
          />
        </div>
        <div>
          <label className="text-sm font-semibold text-dim">Plan</label>
          <select
            value={planCode}
            onChange={(e) => setPlanCode(e.target.value)}
            className="mt-1 w-full rounded-xl border border-line bg-surface2 px-3 py-2.5 outline-none focus:border-brand"
          >
            <option value="starter">Starter — KSh 299/mo</option>
            <option value="growth">Growth ⭐ — KSh 499/mo</option>
            <option value="business">Business — KSh 799/mo</option>
            <option value="pro">Pro — KSh 1,299/mo</option>
          </select>
        </div>
        <div>
          <label className="text-sm font-semibold text-dim">Owner dashboard PIN (4+ digits)</label>
          <input
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
            inputMode="numeric"
            placeholder="e.g. 2026"
            className="mt-1 w-full rounded-xl border border-line bg-surface2 px-3 py-2.5 tracking-widest outline-none focus:border-brand"
            required
            minLength={4}
          />
        </div>
        {err && <p className="text-sm text-bad">{err}</p>}
        <button
          disabled={busy}
          className="w-full rounded-xl bg-plum px-4 py-3 font-bold text-white transition hover:bg-[#4d2f48] disabled:opacity-50"
        >
          {busy ? "Creating…" : "Create my business"}
        </button>
      </form>
      <p className="mt-3 text-center text-xs text-dim">
        Demo login: business <b>xyz-salon</b>, PIN <b>2026</b>
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
