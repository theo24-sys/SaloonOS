"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { api, money, store, Subscription, Plan, MpesaPaymentRow, StkStatus } from "@/lib/api";
import { MpesaTrustStrip, MpesaScanTile } from "@/app/mpesa";

type Cycle = "monthly" | "annual";
type Phase = "form" | "waiting" | "done" | "error";

const STATE_STYLE: Record<string, string> = {
  trial: "bg-info/15 text-info",
  paid: "bg-good/15 text-good",
  expired: "bg-bad/15 text-bad",
};

export default function BillingPage() {
  const [unlocked, setUnlocked] = useState(false);
  const [pin, setPin] = useState("");
  const [lockErr, setLockErr] = useState("");
  const [plans, setPlans] = useState<Plan[]>([]);
  const [sub, setSub] = useState<Subscription | null>(null);
  const [currentPlan, setCurrentPlan] = useState("");
  const [planCode, setPlanCode] = useState("");
  const [cycle, setCycle] = useState<Cycle>("monthly");
  const [phone, setPhone] = useState("");
  const [phase, setPhase] = useState<Phase>("form");
  const [statusMsg, setStatusMsg] = useState("");
  const [receipt, setReceipt] = useState("");
  const [history, setHistory] = useState<MpesaPaymentRow[]>([]);
  const [scanCode, setScanCode] = useState("");
  const [scanMsg, setScanMsg] = useState("");
  const [scanOk, setScanOk] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadAll = useCallback((p: string) => {
    api.mpesaHistory(store.slug, p).then((d) => {
      setSub(d.subscription);
      setHistory(d.payments);
      setUnlocked(true);
    }).catch((e) => { setLockErr(e.message); });
  }, []);

  useEffect(() => {
    const saved = store.pin;
    api.plans().then(setPlans).catch(() => {});
    if (saved) { setPin(saved); loadAll(saved); }
  }, [loadAll]);

  // remember current plan once subscription context arrives via dashboard-less call
  useEffect(() => {
    if (unlocked && !currentPlan) {
      api.catalog(store.slug).then((c) => {
        setCurrentPlan(c.business.plan.code);
        setPlanCode((pc) => pc || c.business.plan.code);
      }).catch(() => {});
    }
  }, [unlocked, currentPlan]);

  const stopPoll = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  useEffect(() => stopPoll, []);

  function startPolling(paymentId: number) {
    stopPoll();
    const started = Date.now();
    pollRef.current = setInterval(async () => {
      try {
        const s: StkStatus = await api.stkStatus(store.slug, store.pin, paymentId);
        setSub(s.subscription);
        if (s.status === "success") {
          stopPoll(); setReceipt(s.mpesa_receipt || "—"); setPhase("done"); loadAll(store.pin);
        } else if (s.status !== "pending") {
          stopPoll(); setStatusMsg(s.result_desc || "The payment did not go through."); setPhase("error");
        } else if (Date.now() - started > 120_000) {
          stopPoll(); setStatusMsg("Timed out waiting for M-Pesa. Check your phone — if you already entered your PIN, refresh in a moment."); setPhase("error");
        }
      } catch { /* transient — keep polling */ }
    }, 3000);
  }

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    setLockErr("");
    const digits = phone.replace(/\D/g, "");
    if (!/^(?:0?254|254)?[17]\d{8}$/.test(digits) && !/^0[17]\d{8}$/.test(digits)) {
      setLockErr("Enter a valid Safaricom number, for example 0712 345 678.");
      return;
    }
    try {
      const r = await api.stkInitiate(store.slug, store.pin, { phone, cycle, plan_code: planCode || undefined });
      setStatusMsg(r.message);
      setPhase("waiting");
      startPolling(r.payment_id);
    } catch (err) {
      setStatusMsg((err as Error).message);
      setPhase("error");
    }
  }

  async function redeem(e: React.FormEvent) {
    e.preventDefault();
    setScanMsg("");
    try {
      const r = await api.redeemScanPlan(store.slug, store.pin, scanCode.trim());
      setScanOk(true);
      setScanMsg(`✓ KSh ${r.amount} applied — plan active until ${new Date(r.paid_until).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })}.`);
      setSub(r.subscription);
      setScanCode("");
      loadAll(store.pin);
    } catch (err) {
      setScanOk(false);
      setScanMsg((err as Error).message);
    }
  }

  function unlock(e: React.FormEvent) {
    e.preventDefault();
    loadAll(pin);
  }

  if (!unlocked) {
    return (
      <main className="mx-auto max-w-md px-5 py-16">
        <form onSubmit={unlock} className="card mx-auto max-w-xs p-6 text-center">
          <Image src="/favicon.png" alt="SaloonOS" width={64} height={64} className="mx-auto h-16 w-16 rounded-2xl" />
          <h1 className="font-display mt-2 text-xl font-bold">SaloonOS</h1>
          <p className="text-xs uppercase tracking-[0.25em] text-dim">Billing</p>
          <p className="mt-3 text-sm text-dim">Enter your owner PIN</p>
          <input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)}
            placeholder="••••" className="mt-4 w-full rounded-xl border border-line bg-surface2 px-3 py-3 text-center text-xl tracking-[0.5em] outline-none focus:border-brand" />
          {lockErr && <p className="mt-2 text-sm text-bad">{lockErr}</p>}
          <button className="mt-3 w-full rounded-xl bg-plum px-4 py-3 font-bold text-white">Unlock</button>
        </form>
      </main>
    );
  }

  const selected = plans.find((p) => p.code === (planCode || currentPlan));
  const amount = selected ? (cycle === "annual" ? selected.price_annual : selected.price_monthly) : 0;
  const subBadge = sub ? STATE_STYLE[sub.state] : "";

  return (
    <main className="payment-page mx-auto max-w-4xl px-5 py-8">
      <div className="payment-heading flex items-center justify-between">
        <div>
          <div className="eyebrow"><span className="eyebrow-dot" /> M-Pesa account billing</div>
          <h1 className="font-display mt-2 text-4xl font-semibold tracking-[-.035em]">Keep your salon <em>in sync.</em></h1>
          <p className="mt-2 max-w-lg text-sm leading-6 text-dim">Choose a plan, approve securely in M-Pesa, and keep customer verification running without interruption.</p>
        </div>
        <Link href="/owner" className="rounded-full border border-line bg-surface px-4 py-2 text-sm font-semibold text-dim transition hover:border-brand hover:text-ink">← Dashboard</Link>
      </div>

      <MpesaTrustStrip note="Approve the payment on your phone · your PIN stays private" />

      {sub && (
        <div className="mt-4 rounded-2xl border border-line bg-surface p-4">
          <div className="flex items-center justify-between">
            <span className="font-semibold">Subscription</span>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide ${subBadge}`}>{sub.state}</span>
          </div>
          <p className="mt-1 text-sm text-dim">
            {sub.state === "expired" ? "Your free trial ended — pay below to keep verifying bills."
              : sub.state === "trial" ? `Free trial · ${sub.days_left} day${sub.days_left === 1 ? "" : "s"} left`
              : `Paid until ${sub.end ? new Date(sub.end).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" }) : "—"} (${sub.days_left} days left)`}
          </p>
        </div>
      )}

      {phase === "form" && (
        <form onSubmit={pay} className="payment-form mt-5 rounded-2xl border border-line bg-surface p-5 sm:p-6">
          <div className="payment-step-label"><span>01</span><div><h2 className="font-display font-bold">Choose your plan</h2><p>Scale your verification as your team grows.</p></div></div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {plans.map((p) => (
              <button type="button" key={p.code} onClick={() => setPlanCode(p.code)}
                className={`plan-choice ${planCode === p.code || (!planCode && p.code === currentPlan) ? "is-selected" : ""}`}>
                <span className="plan-choice-dot" />
                <span className="plan-choice-name">{p.name}{p.code === currentPlan && <small>Current</small>}</span>
                <strong>{money(cycle === "annual" ? p.price_annual : p.price_monthly)} <small>/ {cycle === "annual" ? "year" : "month"}</small></strong>
              </button>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            {(["monthly", "annual"] as Cycle[]).map((c) => (
              <button type="button" key={c} onClick={() => setCycle(c)}
                className={`cycle-choice ${cycle === c ? "is-selected" : ""}`}>
                {c === "monthly" ? "Monthly" : "Annual · 2 months free"}
              </button>
            ))}
          </div>

          <div className="payment-step-label mt-6"><span>02</span><div><h2 className="font-display font-bold">Where should we send the prompt?</h2><p>Enter the Safaricom number that will approve this payment.</p></div></div>
          <input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07XX XXX XXX"
            className="mt-2 w-full rounded-xl border border-line bg-surface2 px-3 py-3 text-lg outline-none focus:border-brand" />
          {lockErr && <p className="mt-2 text-sm text-bad">{lockErr}</p>}

          <button disabled={!phone || !amount} className="mpesa-primary-button mt-5 w-full rounded-xl px-4 py-3.5 font-bold text-white disabled:opacity-50">
            <span className="mpesa-button-mark">M</span> Send {money(amount)} M-Pesa prompt <span aria-hidden>↗</span>
          </button>
          <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-xs text-dim"><span className="trust-check small">✓</span> You&apos;ll get an STK push — enter your M-Pesa PIN to approve.</p>
        </form>
      )}

      {phase === "waiting" && (
        <div className="payment-state waiting mt-5 rounded-2xl border p-7 text-center">
          <div className="phone-pulse mx-auto"><span>⌁</span></div>
          <h2 className="font-display mt-4 text-2xl font-bold">Check your phone</h2>
          <p className="mt-1 text-sm text-dim">{statusMsg}</p>
          <p className="mt-1 text-xs text-dim">Waiting for confirmation…</p>
          <button onClick={() => { stopPoll(); setPhase("form"); }} className="mt-4 text-sm font-semibold text-dim underline">Cancel</button>
        </div>
      )}

      {phase === "done" && (
        <div className="payment-state success mt-5 rounded-2xl border p-7 text-center">
          <div className="success-mark">✓</div>
          <h2 className="font-display mt-3 text-2xl font-bold">Payment received</h2>
          <p className="mt-1 text-sm text-dim">M-Pesa receipt <span className="font-mono font-semibold text-ink">{receipt}</span></p>
          {sub?.end && <p className="text-sm text-dim">Plan active until {new Date(sub.end).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })} ♡</p>}
          <div className="mt-4 flex justify-center gap-2">
            <button onClick={() => { setPhase("form"); setPhone(""); }} className="rounded-xl border border-line bg-surface2 px-4 py-2 text-sm font-semibold">Pay again</button>
            <Link href="/owner" className="rounded-xl bg-[#3AA335] px-4 py-2 text-sm font-bold text-white">Back to dashboard</Link>
          </div>
        </div>
      )}

      {phase === "error" && (
        <div className="payment-state error mt-5 rounded-2xl border p-7 text-center">
          <div className="error-mark">!</div>
          <h2 className="font-display mt-3 text-2xl font-bold">Payment not completed</h2>
          <p className="mt-1 text-sm text-dim">{statusMsg}</p>
          <button onClick={() => setPhase("form")} className="mt-4 rounded-xl bg-[#3AA335] px-4 py-2 text-sm font-bold text-white">Try again</button>
        </div>
      )}

      {/* Scan-to-pay — the official QR sticker, for those who prefer
          paying from their M-Pesa app without an STK prompt. */}
      <MpesaScanTile />

      {/* Already scanned? Redeem the receipt code directly — no human work. */}
      {phase === "form" && (
        <form onSubmit={redeem} className="mt-4 rounded-2xl border border-line bg-surface p-4">
          <h2 className="font-display font-bold">Already paid by scanning the QR?</h2>
          <p className="text-xs text-dim">Enter the receipt code from your M-Pesa SMS to activate your plan instantly.</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input value={scanCode} onChange={(e) => setScanCode(e.target.value.toUpperCase())} placeholder="e.g. SJ84K2ABCD"
              className="min-w-0 flex-1 rounded-xl border border-line bg-surface2 px-3 py-2.5 font-mono uppercase outline-none focus:border-brand" />
            <button disabled={scanCode.trim().length < 8}
              className="rounded-xl bg-[#3AA335] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">Apply to my plan</button>
          </div>
          {scanMsg && <p className={`mt-2 text-sm ${scanOk ? "text-good" : "text-bad"}`}>{scanMsg}</p>}
        </form>
      )}

      {history.length > 0 && (
        <div className="mt-4 overflow-hidden rounded-2xl border border-line bg-surface p-4">
          <h2 className="font-display font-bold">Payment history</h2>
          <div className="-mx-4 overflow-x-auto px-4">
            <table className="mt-2 w-full min-w-[28rem] text-sm sm:min-w-0">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-dim">
                  <th className="whitespace-nowrap py-2">When</th><th className="whitespace-nowrap">Plan</th><th className="whitespace-nowrap text-right">Amount</th><th className="whitespace-nowrap">Receipt</th><th className="whitespace-nowrap">Status</th>
                </tr>
              </thead>
              <tbody>
                {history.map((p) => (
                  <tr key={p.id} className="border-t border-line">
                    <td className="whitespace-nowrap py-2 text-xs text-dim">{new Date(p.created_at).toLocaleDateString("en-KE", { day: "numeric", month: "short" })}</td>
                    <td className="whitespace-nowrap">{p.plan} <span className="text-xs text-dim">({p.cycle})</span></td>
                    <td className="whitespace-nowrap text-right font-semibold">{money(p.amount)}</td>
                    <td className="whitespace-nowrap pr-3 font-mono text-xs">{p.mpesa_receipt || "—"}</td>
                    <td><span className={`text-xs font-semibold ${p.status === "success" ? "text-good" : p.status === "pending" ? "text-warn" : "text-bad"}`}>{p.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  );
}
