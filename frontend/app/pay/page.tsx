"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, money, store, Subscription, Plan, MpesaPaymentRow, StkStatus } from "@/lib/api";

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
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [statusMsg, setStatusMsg] = useState("");
  const [receipt, setReceipt] = useState("");
  const [history, setHistory] = useState<MpesaPaymentRow[]>([]);
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
    try {
      const r = await api.stkInitiate(store.slug, store.pin, { phone, cycle, plan_code: planCode || undefined });
      setPendingId(r.payment_id);
      setStatusMsg(r.message);
      setPhase("waiting");
      startPolling(r.payment_id);
    } catch (err) {
      setLockErr((err as Error).message);
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
          <img src="/favicon.png" alt="SaloonOS" className="mx-auto h-16 w-16 rounded-2xl" />
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
    <main className="mx-auto max-w-2xl px-5 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold">Billing</h1>
          <p className="text-sm text-dim">Pay your SaloonOS plan with M-Pesa</p>
        </div>
        <Link href="/owner" className="rounded-xl border border-line bg-surface px-3 py-1.5 text-sm font-semibold text-dim">← Dashboard</Link>
      </div>

      <div className="mt-4 overflow-hidden rounded-2xl border border-[#3AA335]/30 bg-gradient-to-r from-[#eaf7ec] via-[#f2faf3] to-[#e8f6ea] p-4">
        <div className="flex items-center gap-3">
          <img src="/mpesa-logo.png" alt="M-Pesa" className="h-10 w-10 rounded-lg border border-[#3AA335]/25 bg-white p-1" />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-sm font-bold text-[#0b6e35]">
              <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-[#3AA335] text-[10px] text-white">✓</span>
              Secured by M-Pesa
            </p>
            <p className="text-xs text-[#3f6b4d]">Official Safaricom Daraja payments · you approve every payment on your phone</p>
          </div>
        </div>
      </div>

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
        <form onSubmit={pay} className="mt-4 rounded-2xl border border-line bg-surface p-4">
          <h2 className="font-display font-bold">1 · Choose plan & period</h2>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {plans.map((p) => (
              <button type="button" key={p.code} onClick={() => setPlanCode(p.code)}
                className={`rounded-xl border p-3 text-left text-sm ${planCode === p.code || (!planCode && p.code === currentPlan) ? "border-brand bg-brand/10" : "border-line bg-surface2"}`}>
                <div className="font-semibold">{p.name}{p.code === currentPlan && <span className="ml-1 text-xs text-dim">(current)</span>}</div>
                <div className="text-dim">{money(cycle === "annual" ? p.price_annual : p.price_monthly)} / {cycle === "annual" ? "yr" : "mo"}</div>
              </button>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            {(["monthly", "annual"] as Cycle[]).map((c) => (
              <button type="button" key={c} onClick={() => setCycle(c)}
                className={`flex-1 rounded-xl border px-3 py-2 text-sm font-semibold ${cycle === c ? "border-brand bg-brand/10 text-ink" : "border-line bg-surface2 text-dim"}`}>
                {c === "monthly" ? "Monthly" : "Annual · 2 months free"}
              </button>
            ))}
          </div>

          <h2 className="font-display mt-5 font-bold">2 · M-Pesa number</h2>
          <input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07XX XXX XXX"
            className="mt-2 w-full rounded-xl border border-line bg-surface2 px-3 py-3 text-lg outline-none focus:border-brand" />
          {lockErr && <p className="mt-2 text-sm text-bad">{lockErr}</p>}

          <button disabled={!phone || !amount} className="mt-4 w-full rounded-xl bg-[#3AA335] px-4 py-3 font-bold text-white shadow-[0_10px_24px_-12px_rgba(58,163,53,0.7)] transition hover:bg-[#33922f] disabled:opacity-50">
            Pay {money(amount)} via M-Pesa
          </button>
          <p className="mt-2 text-center text-xs text-dim">You&apos;ll get an STK push — enter your M-Pesa PIN to approve.</p>
        </form>
      )}

      {phase === "waiting" && (
        <div className="mt-4 rounded-2xl border border-[#3AA335]/40 bg-[#f4faf5] p-6 text-center">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-[#3AA335] border-t-transparent" />
          <h2 className="font-display mt-4 font-bold">Check your phone 📲</h2>
          <p className="mt-1 text-sm text-dim">{statusMsg}</p>
          <p className="mt-1 text-xs text-dim">Waiting for confirmation…</p>
          <button onClick={() => { stopPoll(); setPhase("form"); }} className="mt-4 text-sm font-semibold text-dim underline">Cancel</button>
        </div>
      )}

      {phase === "done" && (
        <div className="mt-4 rounded-2xl border border-[#3AA335] bg-[#f4faf5] p-6 text-center">
          <div className="text-4xl">✓</div>
          <h2 className="font-display mt-2 font-bold">Payment received</h2>
          <p className="mt-1 text-sm text-dim">M-Pesa receipt <span className="font-mono font-semibold text-ink">{receipt}</span></p>
          {sub?.end && <p className="text-sm text-dim">Plan active until {new Date(sub.end).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })} ♡</p>}
          <div className="mt-4 flex justify-center gap-2">
            <button onClick={() => { setPhase("form"); setPhone(""); }} className="rounded-xl border border-line bg-surface2 px-4 py-2 text-sm font-semibold">Pay again</button>
            <Link href="/owner" className="rounded-xl bg-[#3AA335] px-4 py-2 text-sm font-bold text-white">Back to dashboard</Link>
          </div>
        </div>
      )}

      {phase === "error" && (
        <div className="mt-4 rounded-2xl border border-bad bg-surface p-6 text-center">
          <div className="text-4xl">⚠</div>
          <h2 className="font-display mt-2 font-bold">Payment not completed</h2>
          <p className="mt-1 text-sm text-dim">{statusMsg}</p>
          <button onClick={() => setPhase("form")} className="mt-4 rounded-xl bg-[#3AA335] px-4 py-2 text-sm font-bold text-white">Try again</button>
        </div>
      )}

      {/* Scan-to-pay — the official Daraja QR sticker, for those who prefer
          paying from their M-Pesa app without an STK prompt. */}
      <div className="mt-4 overflow-hidden rounded-2xl border border-[#3AA335]/35 bg-surface">
        <div className="flex items-center gap-2 bg-[#3AA335] px-4 py-2.5">
          <span className="text-lg">📱</span>
          <div>
            <p className="text-sm font-extrabold uppercase tracking-[0.18em] text-white">Scan to pay</p>
            <p className="text-[11px] text-[#e2f5e5]">Lipa na Bonga via MY ONEAPP — or dial <span className="font-mono font-bold">*126#</span></p>
          </div>
        </div>
        <div className="flex flex-col items-center gap-4 p-5 sm:flex-row sm:items-center">
          <div className="rounded-2xl border-2 border-[#3AA335]/40 bg-white p-2 shadow-[0_12px_30px_-18px_rgba(11,110,53,0.55)]">
            <img src="/mpesa-qr.png" alt="M-Pesa scan-to-pay QR" className="h-40 w-40 sm:h-44 sm:w-44" />
          </div>
          <div className="text-center sm:text-left">
            <p className="font-display text-lg font-bold text-[#0b6e35]">MORGGY TECHNOLOGIES</p>
            <p className="mt-1 text-sm text-dim">Prefer no prompt? Scan with your M-Pesa app and pay directly.</p>
            <div className="mt-2 inline-flex items-center gap-2 rounded-full bg-[#eaf7ec] px-3 py-1 text-sm font-bold text-[#0b6e35]">
              Paybill <span className="font-mono">4567052</span>
            </div>
            <p className="mt-2 text-[11px] text-dim">Scan payments are confirmed to your plan by our team shortly after.</p>
          </div>
        </div>
        <div className="border-t border-[#3AA335]/20 bg-[#f7fbf8] px-4 py-2.5 text-center text-[11px] font-semibold text-[#3f6b4d]">
          Payments processed over Safaricom M-Pesa · receipt issued for every transaction
        </div>
      </div>

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
