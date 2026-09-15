"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { api, Analytics, Dashboard, money, store } from "@/lib/api";
import { Badge } from "@/app/receipt";
import { Icon } from "@/app/icons";
// Badge renders status chips for both pages

const EV_ICON: Record<string, string> = {
  created: "♡", edited: "✎", scanned: "✦", verified: "✓",
  disputed: "⚠", paid: "✓", voided: "🚫", refunded: "↩",
};
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" });

export default function OwnerDash() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [identifier, setIdentifier] = useState(store.slug);
  const [pin, setPin] = useState(store.pin);
  const [err, setErr] = useState("");
  const [locked, setLocked] = useState(true);
  const [analyticsData, setAnalyticsData] = useState<Analytics | null>(null);
  const [inviteUrl, setInviteUrl] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [invitePin, setInvitePin] = useState("");

  const load = useCallback((p: string, targetSlug = store.slug) => {
    setErr("");
    api.dashboard(targetSlug, p)
      .then((d) => { setData(d); setLocked(false); store.slug = targetSlug; store.pin = p; })
      .catch((e) => {
        if (!store.pin) setErr(e.message);
        else { localStorage.removeItem("sp_pin"); setData(null); setLocked(true); }
      });
    api.analytics(targetSlug, p).then(setAnalyticsData).catch(() => {});
  }, []);

  useEffect(() => {
    const saved = store.pin;
    if (saved) load(saved);
  }, [load]);

  // Live refresh — always poll with the last PIN that actually worked
  useEffect(() => {
    if (locked) return;
    const t = setInterval(() => load(store.pin, store.slug), 8000);
    return () => clearInterval(t);
  }, [locked, load]);

  async function createInvite() {
    const name = inviteName.trim();
    if (!name) return;
    try {
      const r = await api.inviteCreate(store.slug, store.pin, name, invitePin);
      const invitePath = new URL(r.url).pathname + new URL(r.url).search;
      setInviteUrl(`${window.location.origin}${invitePath}`);
      setInviteName("");
      setInvitePin("");
      load(store.pin);
    } catch (e) {
      alert((e as Error).message);
    }
  }

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

  async function unlock(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    try {
      const session = await api.ownerLogin(identifier.trim(), pin);
      store.slug = session.slug;
      store.pin = pin;
      load(pin, session.slug);
    } catch (e2) {
      setErr((e2 as Error).message);
    }
  }

  if (locked) {
    return (
      <main className="owner-login-shell mx-auto max-w-md px-5 py-12 sm:py-20">
        <form onSubmit={unlock} className="owner-login-card card mx-auto max-w-sm p-7 text-center sm:p-8">
          <Image src="/logo-full.png" alt="SaloonOS" width={220} height={70} priority className="owner-login-logo mx-auto h-auto w-52" />
          <p className="mt-5 text-xs font-semibold uppercase tracking-[0.25em] text-brand2">Owner dashboard</p>
          <h1 className="font-display mt-2 text-2xl font-bold">Welcome back</h1>
          <p className="mt-2 text-sm leading-6 text-dim">Sign in with your business username or registered phone number and PIN.</p>
          <label className="mt-5 block text-left text-xs font-bold uppercase tracking-wider text-dim" htmlFor="owner-identifier">Username or phone</label>
          <input
            id="owner-identifier"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            autoComplete="username"
            placeholder="e.g. glowstudio or 0712 345 678"
            className="mt-2 w-full rounded-xl border border-line bg-surface2 px-3 py-3 outline-none focus:border-brand focus:ring-4 focus:ring-brand/10"
            required
          />
          <label className="mt-4 block text-left text-xs font-bold uppercase tracking-wider text-dim" htmlFor="owner-pin">Owner PIN</label>
          <input
            id="owner-pin"
            type="password"
            inputMode="numeric"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            autoComplete="current-password"
            placeholder="Enter PIN"
            className="mt-2 w-full rounded-xl border border-line bg-surface2 px-3 py-3 text-center text-xl tracking-[0.5em] outline-none focus:border-brand focus:ring-4 focus:ring-brand/10"
            required
          />
          {err && <p className="mt-2 text-sm text-bad">{err}</p>}
          <button className="mt-5 w-full rounded-xl bg-plum px-4 py-3.5 font-bold text-white shadow-[0_14px_24px_-16px_rgba(76,41,72,.8)] transition hover:-translate-y-0.5 hover:bg-[#382039]">
            Sign in
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
    <main className="owner-dashboard mx-auto max-w-6xl px-5 py-8 lg:px-8">
      <div className="owner-dashboard-header flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-dim">
            {new Date().toLocaleDateString("en-KE", { weekday: "long", day: "numeric", month: "long" })}
          </p>
          <h1 className="font-display text-2xl font-bold">
            Good {greetingTime()}, {data.business.name.split(" ")[0]} <span className="text-brand">♡</span>
          </h1>
          <p className="text-sm text-dim">{data.business.name}</p>
        </div>
        <div className="owner-header-actions flex w-full flex-wrap gap-2 sm:w-auto">
          <Link href="/pay" className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm font-semibold text-dim">
          <Icon name="billing" size={16} /> Billing
          </Link>
          <Link href="/settings" aria-label="Settings" className="inline-flex items-center justify-center rounded-xl border border-line bg-surface p-2 text-dim">
          <Icon name="settings" size={17} />
          </Link>
          <button
            onClick={() => { localStorage.removeItem("sp_pin"); setPin(""); setLocked(true); setData(null); }}
            className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm font-semibold text-dim"
          >
          <Icon name="logout" size={16} /> Logout
          </button>
        </div>
      </div>

      {/* Subscription banner — countdown + 5-day reminder */}
      {data.subscription.state !== "paid" || data.subscription.reminder ? (
        <div className={`mt-4 rounded-2xl border p-4 ${data.subscription.state === "expired" ? "border-bad bg-bad/10" : data.subscription.reminder ? "border-warn bg-warn/10" : "border-info bg-info/10"}`}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm">
              {data.subscription.state === "expired" ? (
                <><span className="font-bold text-bad">Trial ended.</span> <span className="text-dim">Bills can&apos;t be created or verified until the plan is paid.</span></>
              ) : data.subscription.state === "trial" ? (
                <><span className="font-bold">Free trial.</span> <span className="text-dim">
                  {data.subscription.days_left} day{data.subscription.days_left === 1 ? "" : "s"} left
                  {data.subscription.days_left > 0 ? ` — ends ${fmtDate(data.subscription.end)}` : " tonight"}.</span></>
              ) : (
                <><span className="font-bold text-warn">Renewal due soon.</span> <span className="text-dim">Plan expires in {data.subscription.days_left} day{data.subscription.days_left === 1 ? "" : "s"} ({fmtDate(data.subscription.end)}).</span></>
              )}
            </div>
            <Link href="/pay" className="shrink-0 rounded-xl bg-plum px-4 py-2 text-center text-sm font-bold text-white">
              {data.subscription.state === "expired" ? "Pay now" : "View billing"}
            </Link>
          </div>
        </div>
      ) : null}

      {/* Revenue hero */}
      <div className="owner-revenue-card mt-5 rounded-3xl border border-line p-6 text-center">
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
      <div className="owner-kpi-grid mt-3 grid grid-cols-3 gap-3">
        <Stat label="Expected" value={money(data.expected)} />
        <Stat label="Collected" value={money(data.collected)} tone="good" />
        <Stat label="Variance" value={`${data.variance > 0 ? "⚠ " : ""}${money(data.variance)}`} tone={data.variance > 0 ? "warn" : "good"} />
      </div>

      <div className="owner-panel mt-4 rounded-2xl border border-line bg-surface p-4">
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
          <p className="mt-2 text-sm text-warn">⚠ Cap reached — new verifications are blocked. Upgrade in Billing.</p>
        )}
      </div>

      {/* Analytics */}
      {analyticsData && (
        <>
          <div className="owner-panel mt-4 rounded-2xl border border-line bg-surface p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-display font-bold">Revenue — last 14 days</h2>
              {analyticsData.month.mom_pct !== null && (
                <span className={`text-sm font-semibold ${analyticsData.month.mom_pct >= 0 ? "text-good" : "text-bad"}`}>
                  {analyticsData.month.mom_pct >= 0 ? "↑" : "↓"} {Math.abs(analyticsData.month.mom_pct)}% vs last month
                </span>
              )}
            </div>
            <p className="text-xs text-dim">
              This month {money(analyticsData.month.this)} · last month {money(analyticsData.month.last)}
            </p>
            <TrendChart series={analyticsData.trend.series} labels={analyticsData.trend.labels} />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="owner-panel rounded-2xl border border-line bg-surface p-4">
              <h2 className="font-display font-bold">Staff this month</h2>
              {analyticsData.staff.length === 0 && <p className="mt-2 text-sm text-dim">No bills yet this month.</p>}
              {analyticsData.staff.map((s, i) => (
                <div key={s.staff_name} className="mt-3">
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="font-semibold">{i === 0 && s.collected > 0 ? "👑 " : ""}{s.staff_name}</span>
                    <span className="tabular-nums"><span className="font-bold">{money(s.collected)}</span> <span className="text-xs text-dim">· {s.bills} bills · {s.verify_rate}% verified</span></span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface2">
                    <div className="h-full rounded-full bg-brand" style={{ width: `${pct(s.collected, analyticsData.staff[0]?.collected)}%` }} />
                  </div>
                </div>
              ))}
            </div>

            <div className="owner-panel rounded-2xl border border-line bg-surface p-4">
              <h2 className="font-display font-bold">Top services</h2>
              {analyticsData.top_services.length === 0 && <p className="mt-2 text-sm text-dim">No paid services yet this month.</p>}
              {analyticsData.top_services.map((s) => (
                <div key={s.name} className="mt-3">
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="font-semibold">{s.name} <span className="text-xs font-normal text-dim">× {s.count}</span></span>
                    <span className="font-bold tabular-nums">{money(s.revenue)}</span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface2">
                    <div className="h-full rounded-full bg-plum" style={{ width: `${pct(s.revenue, analyticsData.top_services[0]?.revenue)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="owner-panel mt-4 rounded-2xl border border-line bg-surface p-4">
            <h2 className="font-display font-bold">Verification funnel — this month</h2>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <FunnelStep label="Created" value={analyticsData.funnel.created} max={analyticsData.funnel.created} tone="bg-info" />
              <FunnelStep label="Verified" value={analyticsData.funnel.verified} max={analyticsData.funnel.created} tone="bg-brand" />
              <FunnelStep label="Paid" value={analyticsData.funnel.paid} max={analyticsData.funnel.created} tone="bg-good" />
            </div>
            <p className="mt-2 text-xs text-dim">
              {analyticsData.funnel.created - analyticsData.funnel.verified > 0
                ? `${analyticsData.funnel.created - analyticsData.funnel.verified} bill(s) still awaiting customer verification.`
                : "Every bill so far was seen by a customer ✓"}
            </p>
          </div>
        </>
      )}

      {/* Team — invites */}
      <div className="owner-panel mt-4 rounded-2xl border border-line bg-surface p-4">
        <h2 className="font-display font-bold">Team</h2>
        <p className="text-xs text-dim">Assign each staff member a PIN. They will need the invite link and PIN to sign in.</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input value={inviteName} onChange={(e) => setInviteName(e.target.value)} placeholder="Staff name (e.g. Faith)"
            className="flex-1 rounded-xl border border-line bg-surface2 px-3 py-2.5 outline-none focus:border-brand" />
          <input value={invitePin} onChange={(e) => setInvitePin(e.target.value.replace(/\D/g, "").slice(0, 8))} inputMode="numeric" placeholder="PIN (4–8 digits)"
            className="w-full rounded-xl border border-line bg-surface2 px-3 py-2.5 outline-none focus:border-brand sm:w-40" />
          <button onClick={createInvite} disabled={!inviteName.trim() || invitePin.length < 4}
            className="rounded-xl bg-plum px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">Create invite link</button>
        </div>
        {inviteUrl && (
          <div className="mt-3 rounded-xl border border-brand bg-brand/10 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-dim">Share this link with {`the staff member`} (one-time use):</p>
            <div className="mt-1 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate text-sm font-mono">{inviteUrl}</code>
              <button onClick={() => navigator.clipboard.writeText(inviteUrl).then(() => alert("Link copied — share it on WhatsApp or SMS"))}
                className="shrink-0 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-bold">Copy</button>
            </div>
          </div>
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
        <div className="owner-activity-list mt-2 max-h-72 space-y-1.5 overflow-y-auto pr-1">
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

      <div className="owner-panel mt-4 overflow-hidden rounded-2xl border border-line bg-surface p-4">
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

function fmtDate(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString("en-KE", { day: "numeric", month: "short" }) : "—";
}

function pct(v: number, max?: number) {
  return max && max > 0 ? Math.round((v / max) * 100) : 0;
}

function TrendChart({ series, labels }: { series: number[]; labels: string[] }) {
  const max = Math.max(...series, 1);
  return (
    <div>
      <div className="mt-4 flex h-36 items-end gap-[3px] sm:gap-1.5">
        {series.map((v, i) => (
          <div key={i} className="group relative flex-1">
            <div
              className={`w-full rounded-t-md transition-all ${v > 0 ? "bg-brand/80 group-hover:bg-brand" : "bg-surface2"}`}
              style={{ height: `${Math.max(4, (v / max) * 136)}px` }}
            />
            <div className="pointer-events-none absolute -top-8 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-lg border border-line bg-surface px-2 py-1 text-[10px] font-semibold opacity-0 shadow-md transition-opacity group-hover:opacity-100">
              {labels[i]}: {money(v)}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] text-dim">
        <span>{labels[0]}</span><span className="hidden sm:inline">{labels[6]}</span><span>{labels[labels.length - 1]}</span>
      </div>
    </div>
  );
}

function FunnelStep({ label, value, max, tone }: { label: string; value: number; max: number; tone: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface2 p-3">
      <div className={`mx-auto mb-2 h-1.5 w-full max-w-[80px] rounded-full ${tone}`} style={{ opacity: max > 0 ? Math.max(0.25, value / max) : 0.25 }} />
      <div className="font-display text-xl font-bold tabular-nums">{value}</div>
      <div className="text-[11px] text-dim">{label}</div>
    </div>
  );
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
