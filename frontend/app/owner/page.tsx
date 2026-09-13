"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, Dashboard, money, store } from "@/lib/api";
import { Badge } from "@/app/receipt";
// Badge renders status chips for both pages

const EV_ICON: Record<string, string> = {
  created: "♡", edited: "✎", scanned: "✦", verified: "✓",
  disputed: "⚠", paid: "✓", voided: "🚫", refunded: "↩",
};
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" });

export default function OwnerDash() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [pin, setPin] = useState(store.pin);
  const [err, setErr] = useState("");
  const [locked, setLocked] = useState(true);

  const load = useCallback((p: string) => {
    setErr("");
    api.dashboard(store.slug, p)
      .then((d) => { setData(d); setLocked(false); store.pin = p; })
      .catch((e) => {
        if (!store.pin) setErr(e.message);
        else { localStorage.removeItem("sp_pin"); setData(null); setLocked(true); }
      });
  }, []);

  useEffect(() => {
    const saved = store.pin;
    if (saved) load(saved);
  }, [load]);

  // Live refresh — always poll with the last PIN that actually worked
  useEffect(() => {
    if (locked) return;
    const t = setInterval(() => load(store.pin), 8000);
    return () => clearInterval(t);
  }, [locked, load]);

  async function voidBill(code: string) {
    const reason = window.prompt(`Void bill #${code} — reason? (recorded in the audit trail)`);
    if (!reason) return;
    try {
      await api.void(store.slug, store.pin, code, reason);
      load(store.pin);
    } catch (e) {
      alert((e as Error).message);
    }
  }

  function unlock(e: React.FormEvent) {
    e.preventDefault();
    load(pin);
  }

  if (locked) {
    return (
      <main className="mx-auto max-w-md px-5 py-16">
        <form onSubmit={unlock} className="card mx-auto max-w-xs p-6 text-center">
          <img src="/favicon.png" alt="SaloonOS" className="mx-auto h-16 w-16 rounded-2xl" />
          <h1 className="font-display mt-2 text-xl font-bold">SaloonOS</h1>
          <p className="text-xs uppercase tracking-[0.25em] text-dim">Owner dashboard</p>
          <p className="mt-3 text-sm text-dim">Enter your PIN</p>
          <input
            type="password"
            inputMode="numeric"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="••••"
            className="mt-4 w-full rounded-xl border border-line bg-surface2 px-3 py-3 text-center text-xl tracking-[0.5em] outline-none focus:border-brand"
          />
          {err && <p className="mt-2 text-sm text-bad">{err}</p>}
          <button className="mt-3 w-full rounded-xl bg-plum px-4 py-3 font-bold text-white">
            Unlock
          </button>
        </form>
      </main>
    );
  }

  if (!data) return <main className="mx-auto max-w-md px-5 py-10 text-dim">Loading…</main>;

  const risky = data.bills.filter((b) => b.status === "approved" || b.status === "disputed");
  const usagePct = Math.min(100, Math.round((data.plan_usage.verified_bills / data.plan_usage.cap) * 100));
  const growth = data.yesterday_collected > 0
    ? Math.round(((data.collected - data.yesterday_collected) / data.yesterday_collected) * 1000) / 10
    : null;

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-dim">
            {new Date().toLocaleDateString("en-KE", { weekday: "long", day: "numeric", month: "long" })}
          </p>
          <h1 className="font-display text-2xl font-bold">
            Good {greetingTime()}, {data.business.name.split(" ")[0]} <span className="text-brand">♡</span>
          </h1>
          <p className="text-sm text-dim">{data.business.name}</p>
        </div>
        <div className="flex gap-2">
          <Link href="/settings" className="rounded-xl border border-line bg-surface px-3 py-1.5 text-sm font-semibold text-dim">
            ⚙︎
          </Link>
          <button
            onClick={() => { localStorage.removeItem("sp_pin"); setPin(""); setLocked(true); setData(null); }}
            className="rounded-xl border border-line bg-surface px-3 py-1.5 text-sm font-semibold text-dim"
          >
            Lock
          </button>
        </div>
      </div>

      {/* Revenue hero */}
      <div className="mt-5 rounded-3xl border border-line bg-gradient-to-br from-[#fff5f3] via-surface to-[#f6eff5] p-6 text-center shadow-[0_16px_40px_-24px_rgba(93,58,88,0.4)]">
        <div className="text-[11px] font-semibold uppercase tracking-[0.3em] text-dim">Collected today</div>
        <div className="font-display mt-1 text-4xl font-bold tabular-nums sm:text-5xl">{money(data.collected)}</div>
        <div className="mt-2 text-xs font-semibold">
          {growth === null ? (
            <span className="text-dim">— no sales recorded yesterday</span>
          ) : growth >= 0 ? (
            <span className="text-good">↑ {growth}% from yesterday</span>
          ) : (
            <span className="text-warn">↓ {Math.abs(growth)}% from yesterday</span>
          )}
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
          <div><span className="font-display text-lg font-bold sm:text-xl">{data.recorded}</span><div className="text-[11px] text-dim">customers</div></div>
          <div><span className="font-display text-lg font-bold text-good sm:text-xl">{data.verified}</span><div className="text-[11px] text-dim">verified</div></div>
          <div><span className={`font-display text-base font-bold sm:text-xl ${data.unverified ? "text-warn" : ""}`}>{data.unverified ? `${money(data.unverified)}` : "0"}</span><div className="text-[11px] text-dim">pending</div></div>
        </div>
      </div>

      {/* Accountability strip */}
      <div className="mt-3 grid grid-cols-3 gap-3">
        <Stat label="Expected" value={money(data.expected)} />
        <Stat label="Collected" value={money(data.collected)} tone="good" />
        <Stat label="Variance" value={`${data.variance > 0 ? "⚠ " : ""}${money(data.variance)}`} tone={data.variance > 0 ? "warn" : "good"} />
      </div>

      <div className="mt-4 rounded-2xl border border-line bg-surface p-4">
        <div className="flex justify-between text-sm">
          <span className="font-semibold">{data.business.plan.name} plan</span>
          <span className="text-dim">
            {data.plan_usage.verified_bills} / {data.plan_usage.cap} verified bills this month
          </span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface2">
          <div className="h-full rounded-full bg-brand" style={{ width: `${usagePct}%` }} />
        </div>
        {data.plan_usage.remaining === 0 && (
          <p className="mt-2 text-sm text-warn">⚠ Cap reached — new verifications are blocked. Upgrade in Pricing.</p>
        )}
      </div>

      {risky.length > 0 && (
        <div className="mt-4 rounded-2xl border border-warn bg-surface p-4">
          <h2 className="font-display font-bold">⚠ Exceptions — needs attention ({risky.length})</h2>
          {risky.map((b) => (
            <div key={b.code} className="flex items-center justify-between border-b border-line py-3 last:border-0">
              <div>
                <div className="text-sm font-semibold">
                  #{b.code} · {b.customer_name} · {b.staff_name}
                  {b.was_edited && <span className="ml-2 text-xs text-warn">✎ edited before approval</span>}
                </div>
                <div className="text-xs text-dim">
                  {b.items.map((i) => i.name).join(", ")} — {money(b.total)}
                  {b.edits.map((e, i) => (
                    <span key={i}> · {e.item_name} {money(e.old_price)}→{money(e.new_price)} ({e.reason || "no reason"})</span>
                  ))}
                </div>
              </div>
              <Badge status={b.status} />
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 rounded-2xl border border-line bg-surface p-4">
        <h2 className="font-display font-bold">Today&apos;s activity</h2>
        <div className="mt-2 max-h-72 space-y-1.5 overflow-y-auto pr-1">
          {data.audit_feed.map((e, i) => (
            <div key={i} className="flex items-baseline gap-2 text-sm">
              <span className="w-4 text-center text-brand">{EV_ICON[e.type] || "•"}</span>
              <span className="w-12 shrink-0 text-xs text-dim">{fmtTime(e.at)}</span>
              <span className="font-mono text-xs text-info">#{e.code}</span>
              <span className="text-dim">{e.detail}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-2xl border border-line bg-surface p-4">
        <h2 className="font-display font-bold">All bills today</h2>
        <div className="-mx-4 overflow-x-auto px-4">
        <table className="mt-2 w-full min-w-[34rem] text-sm sm:min-w-0">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-dim">
              <th className="py-2">#</th><th>Customer</th><th>Staff</th>
              <th className="text-right">Total</th><th>Status</th><th />
            </tr>
          </thead>
          <tbody>
            {data.bills.map((b) => (
              <tr key={b.code} className="border-t border-line">
                <td className="py-2 font-mono text-xs">{b.code}</td>
                <td>{b.customer_name}</td>
                <td className="text-dim">{b.staff_name}</td>
                <td className="text-right font-semibold">{money(b.total)}</td>
                <td><Badge status={b.status} /></td>
                <td className="text-right">
                  {b.status !== "paid" && b.status !== "voided" && (
                    <button onClick={() => voidBill(b.code)} className="text-xs font-semibold text-dim hover:text-bad">
                      void
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.bills.length === 0 && <p className="py-4 text-center text-dim">No bills yet today.</p>}
        </div>
      </div>
    </main>
  );
}

function greetingTime() {
  const h = new Date().getHours();
  return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "warn" | "bad" }) {
  const color = tone === "good" ? "text-good" : tone === "warn" ? "text-warn" : tone === "bad" ? "text-bad" : "";
  return (
    <div className="rounded-2xl border border-line bg-surface p-4 text-center">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-dim">{label}</div>
      <div className={`mt-1 text-lg font-bold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}
