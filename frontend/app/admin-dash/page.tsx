"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  api,
  money,
  PlatformBusiness,
  PlatformOverview,
  PlatformPayment,
  store,
} from "@/lib/api";

const EV_ICON: Record<string, string> = {
  created: "♡",
  edited: "✎",
  scanned: "✦",
  verified: "✓",
  disputed: "⚠",
  paid: "✓",
  voided: "🚫",
  refunded: "↩",
};

export default function PlatformAdminDashboard() {
  const [adminKey, setAdminKey] = useState("");
  const [keyInput, setKeyInput] = useState("");
  const [authError, setAuthError] = useState("");
  const [tab, setTab] = useState<"overview" | "businesses" | "payments">("overview");

  const [overview, setOverview] = useState<PlatformOverview | null>(null);
  const [businesses, setBusinesses] = useState<PlatformBusiness[]>([]);
  const [payments, setPayments] = useState<PlatformPayment[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  // Edit Tenant Modal
  const [editingBiz, setEditingBiz] = useState<PlatformBusiness | null>(null);
  const [editPlan, setEditPlan] = useState("");
  const [editPin, setEditPin] = useState("");
  const [trialDaysAdd, setTrialDaysAdd] = useState(0);
  const [paidDaysAdd, setPaidDaysAdd] = useState(0);
  const [actionMsg, setActionMsg] = useState("");
  const [saving, setSaving] = useState(false);

  // Load saved key on mount
  useEffect(() => {
    const saved = store.adminKey || "saloonos-master-2026";
    if (saved) {
      setAdminKey(saved);
      setKeyInput(saved);
    }
  }, []);

  const loadData = useCallback(
    async (k: string) => {
      if (!k) return;
      setLoading(true);
      setAuthError("");
      try {
        const [ov, bizRes, payRes] = await Promise.all([
          api.platformOverview(k),
          api.platformBusinesses(k),
          api.platformPayments(k),
        ]);
        setOverview(ov);
        setBusinesses(bizRes.businesses);
        setPayments(payRes.payments);
        store.adminKey = k;
      } catch (err) {
        setAuthError((err as Error).message);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (adminKey) {
      loadData(adminKey);
    }
  }, [adminKey, loadData]);

  function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!keyInput.trim()) return;
    setAdminKey(keyInput.trim());
    loadData(keyInput.trim());
  }

  async function handleSaveBiz(e: React.FormEvent) {
    e.preventDefault();
    if (!editingBiz || !adminKey) return;
    setSaving(true);
    setActionMsg("");
    try {
      const payload: {
        plan_code?: string;
        owner_pin?: string;
        trial_days_add?: number;
        paid_days_add?: number;
      } = {};
      if (editPlan && editPlan !== editingBiz.plan.code) payload.plan_code = editPlan;
      if (editPin && editPin !== editingBiz.owner_pin) payload.owner_pin = editPin;
      if (trialDaysAdd > 0) payload.trial_days_add = trialDaysAdd;
      if (paidDaysAdd > 0) payload.paid_days_add = paidDaysAdd;

      await api.platformUpdateBusiness(adminKey, editingBiz.slug, payload);
      setActionMsg("Tenant updated successfully!");
      setTrialDaysAdd(0);
      setPaidDaysAdd(0);
      await loadData(adminKey);
      setTimeout(() => {
        setEditingBiz(null);
        setActionMsg("");
      }, 1200);
    } catch (err) {
      setActionMsg(`Error: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  const filteredBusinesses = businesses.filter((b) => {
    const q = search.toLowerCase().trim();
    if (!q) return true;
    return (
      b.name.toLowerCase().includes(q) ||
      b.slug.toLowerCase().includes(q) ||
      b.plan.name.toLowerCase().includes(q) ||
      (b.phone && b.phone.includes(q))
    );
  });

  // Admin Key Gate
  if (!adminKey || authError) {
    return (
      <main className="mx-auto max-w-md px-5 py-16">
        <div className="rounded-3xl border border-line bg-surface p-8 shadow-sm">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-plum/10 text-3xl text-plum">
            🛡️
          </div>
          <h1 className="text-center font-display text-2xl font-bold">Platform Admin</h1>
          <p className="mt-1 text-center text-xs text-dim">
            Master monitoring and tenant management dashboard
          </p>

          <form onSubmit={handleLogin} className="mt-6 space-y-4">
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-dim">
                Master Admin Key
              </label>
              <input
                type="password"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder="Enter master key"
                className="mt-1.5 w-full rounded-xl border border-line bg-surface2 px-3.5 py-2.5 outline-none focus:border-brand"
                required
              />
            </div>

            {authError && <p className="text-xs font-semibold text-bad">{authError}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-plum px-4 py-3 font-bold text-white transition hover:bg-[#4d2f48] disabled:opacity-50"
            >
              {loading ? "Authenticating…" : "Unlock Dashboard"}
            </button>
          </form>
          <p className="mt-4 text-center text-[11px] text-dim">
            Default Key: <code className="rounded bg-surface2 px-1 py-0.5 font-mono">saloonos-master-2026</code>
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      {/* Header */}
      <div className="flex flex-col gap-4 border-b border-line pb-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-good/15 px-2 py-0.5 text-xs font-bold text-good">
              ● Live Platform
            </span>
            <span className="text-xs text-dim">v1.2 · M-Pesa Integrated</span>
          </div>
          <h1 className="mt-1 font-display text-3xl font-bold tracking-tight">
            Platform Operations & Monitoring
          </h1>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => loadData(adminKey)}
            disabled={loading}
            className="rounded-xl border border-line bg-surface px-3 py-2 text-xs font-semibold hover:border-brand"
          >
            {loading ? "Refreshing…" : "↻ Refresh"}
          </button>
          <button
            onClick={() => {
              store.adminKey = "";
              setAdminKey("");
            }}
            className="rounded-xl border border-bad/30 bg-bad/5 px-3 py-2 text-xs font-semibold text-bad hover:bg-bad/10"
          >
            Lock
          </button>
        </div>
      </div>

      {/* Top Metric Hero Cards */}
      {overview && (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-2xl border border-line bg-surface p-4">
            <div className="text-xs font-semibold text-dim">Total Salons / Tenants</div>
            <div className="mt-1 text-2xl font-black text-ink">{overview.total_businesses}</div>
            <div className="mt-2 flex gap-1.5 text-[11px]">
              <span className="font-semibold text-good">{overview.subscriptions.paid} paid</span>
              <span className="text-dim">·</span>
              <span className="text-brand font-semibold">{overview.subscriptions.trial} trial</span>
              <span className="text-dim">·</span>
              <span className="text-bad font-semibold">{overview.subscriptions.expired} exp</span>
            </div>
          </div>

          <div className="rounded-2xl border border-line bg-surface p-4">
            <div className="text-xs font-semibold text-dim">Monthly Recurring Rev (MRR)</div>
            <div className="mt-1 text-2xl font-black text-plum">{money(overview.subscriptions.mrr)}</div>
            <div className="mt-2 text-[11px] text-dim">from active tenant subscriptions</div>
          </div>

          <div className="rounded-2xl border border-line bg-surface p-4">
            <div className="text-xs font-semibold text-dim">Platform GMV Processed</div>
            <div className="mt-1 text-2xl font-black text-good">{money(overview.bills_summary.total_gmv)}</div>
            <div className="mt-2 text-[11px] text-dim">{overview.bills_summary.paid} paid customer bills</div>
          </div>

          <div className="rounded-2xl border border-line bg-surface p-4">
            <div className="text-xs font-semibold text-dim">QR Verification Compliance</div>
            <div className="mt-1 text-2xl font-black text-ink">
              {overview.bills_summary.verification_rate}%
            </div>
            <div className="mt-2 text-[11px] text-dim">
              {overview.bills_summary.verified} of {overview.bills_summary.total} verified
            </div>
          </div>
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="mt-8 flex gap-2 border-b border-line pb-2">
        <button
          onClick={() => setTab("overview")}
          className={`rounded-xl px-4 py-2 text-sm font-bold transition ${
            tab === "overview" ? "bg-plum text-white" : "text-dim hover:text-ink"
          }`}
        >
          📊 Overview & Stream
        </button>
        <button
          onClick={() => setTab("businesses")}
          className={`rounded-xl px-4 py-2 text-sm font-bold transition ${
            tab === "businesses" ? "bg-plum text-white" : "text-dim hover:text-ink"
          }`}
        >
          🏢 Salons & Tenants ({businesses.length})
        </button>
        <button
          onClick={() => setTab("payments")}
          className={`rounded-xl px-4 py-2 text-sm font-bold transition ${
            tab === "payments" ? "bg-plum text-white" : "text-dim hover:text-ink"
          }`}
        >
          💳 M-Pesa Ledger ({payments.length})
        </button>
      </div>

      {/* TAB 1: Overview & Live Feed */}
      {tab === "overview" && overview && (
        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          {/* Subscriptions breakdown */}
          <div className="space-y-6 lg:col-span-1">
            <div className="rounded-2xl border border-line bg-surface p-5">
              <h2 className="font-display text-base font-bold">Subscription Health</h2>
              <div className="mt-4 space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-good"></span> Active Paid
                  </span>
                  <span className="font-bold">{overview.subscriptions.paid}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-brand"></span> 7-Day Free Trial
                  </span>
                  <span className="font-bold">{overview.subscriptions.trial}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-bad"></span> Expired
                  </span>
                  <span className="font-bold">{overview.subscriptions.expired}</span>
                </div>
              </div>

              <div className="mt-6 border-t border-dashed border-line pt-4">
                <div className="text-xs font-semibold text-dim">Fraud & Variance Detection</div>
                <div className="mt-2 flex justify-between text-sm">
                  <span>Disputed Bills Flagged</span>
                  <span className="font-bold text-bad">{overview.bills_summary.disputed}</span>
                </div>
                <div className="mt-1 flex justify-between text-sm">
                  <span>Voided Bills</span>
                  <span className="font-bold text-dim">{overview.bills_summary.voided}</span>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-line bg-surface p-5">
              <h2 className="font-display text-base font-bold">Quick Actions</h2>
              <div className="mt-3 flex flex-col gap-2">
                <Link
                  href="/pricing"
                  className="rounded-xl border border-line bg-surface2 px-3 py-2 text-xs font-semibold hover:border-brand"
                >
                  View Public Pricing Matrix →
                </Link>
                <Link
                  href="/signup"
                  className="rounded-xl border border-line bg-surface2 px-3 py-2 text-xs font-semibold hover:border-brand"
                >
                  Register New Salon (Demo / Trial) →
                </Link>
              </div>
            </div>
          </div>

          {/* Live Activity Stream */}
          <div className="rounded-2xl border border-line bg-surface p-5 lg:col-span-2">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-base font-bold">Global Audit Stream</h2>
              <span className="text-xs text-dim">Real-time across all salons</span>
            </div>

            <div className="mt-4 max-h-[520px] space-y-2.5 overflow-y-auto pr-1">
              {overview.recent_events.map((e) => (
                <div
                  key={e.id}
                  className="flex items-start justify-between rounded-xl border border-line bg-surface2 p-3 text-xs"
                >
                  <div className="flex items-start gap-2.5">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-surface font-mono font-bold text-plum">
                      {EV_ICON[e.type] || "•"}
                    </span>
                    <div>
                      <div className="font-semibold text-ink">
                        <span className="font-bold text-plum">{e.business_name}</span> · Bill #{e.bill_code}
                      </div>
                      <div className="mt-0.5 text-dim">
                        <span className="capitalize font-medium text-ink">{e.type}:</span> {e.detail}
                      </div>
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-[11px] text-dim">
                    {new Date(e.at).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: Salons Directory & Tenant Management */}
      {tab === "businesses" && (
        <div className="mt-6 space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search salon name, slug, plan, phone…"
              className="w-full max-w-sm rounded-xl border border-line bg-surface px-3.5 py-2 text-sm outline-none focus:border-brand"
            />
            <div className="text-xs text-dim">
              Showing {filteredBusinesses.length} of {businesses.length} registered salons
            </div>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-line bg-surface2 font-semibold text-dim uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="p-3.5">Salon / Slug</th>
                  <th className="p-3.5">Plan Tier</th>
                  <th className="p-3.5">Subscription</th>
                  <th className="p-3.5">Staff</th>
                  <th className="p-3.5">Bills & GMV</th>
                  <th className="p-3.5">Owner PIN</th>
                  <th className="p-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filteredBusinesses.map((b) => (
                  <tr key={b.id} className="hover:bg-surface2/60 transition">
                    <td className="p-3.5">
                      <div className="font-bold text-sm text-ink">{b.name}</div>
                      <div className="font-mono text-[11px] text-dim">slug: {b.slug}</div>
                      {b.location && <div className="text-[11px] text-dim">{b.location}</div>}
                    </td>
                    <td className="p-3.5">
                      <span className="rounded-lg bg-plum/10 px-2 py-1 font-bold text-plum">
                        {b.plan.name}
                      </span>
                      <div className="mt-1 text-[11px] text-dim">
                        KSh {b.plan.price_monthly}/mo (max {b.plan.max_staff} staff)
                      </div>
                    </td>
                    <td className="p-3.5">
                      <span
                        className={`rounded-lg px-2 py-0.5 text-[11px] font-bold ${
                          b.subscription.state === "paid"
                            ? "bg-good/15 text-good"
                            : b.subscription.state === "trial"
                            ? "bg-brand/15 text-brand"
                            : "bg-bad/15 text-bad"
                        }`}
                      >
                        {b.subscription.state.toUpperCase()}
                      </span>
                      <div className="mt-1 text-[11px] text-dim">
                        {b.subscription.days_left} days remaining
                      </div>
                    </td>
                    <td className="p-3.5 font-semibold">
                      {b.staff_count} / {b.plan.max_staff}
                    </td>
                    <td className="p-3.5">
                      <div className="font-bold">{money(b.total_revenue)}</div>
                      <div className="text-[11px] text-dim">
                        {b.verified_bills} / {b.total_bills} verified
                        {b.disputed_bills > 0 && (
                          <span className="text-bad font-semibold"> ({b.disputed_bills} disp)</span>
                        )}
                      </div>
                    </td>
                    <td className="p-3.5 font-mono font-bold text-plum">{b.owner_pin}</td>
                    <td className="p-3.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => {
                            setEditingBiz(b);
                            setEditPlan(b.plan.code);
                            setEditPin(b.owner_pin);
                            setTrialDaysAdd(0);
                            setPaidDaysAdd(0);
                            setActionMsg("");
                          }}
                          className="rounded-lg bg-plum px-2.5 py-1 font-bold text-white hover:bg-[#4d2f48]"
                        >
                          Manage
                        </button>
                        <button
                          onClick={() => {
                            store.slug = b.slug;
                            store.pin = b.owner_pin;
                            window.open("/owner", "_blank");
                          }}
                          className="rounded-lg border border-line bg-surface2 px-2 py-1 text-[11px] font-semibold hover:border-brand"
                          title="Open Tenant Owner Dashboard"
                        >
                          Owner ↗
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: Global M-Pesa Ledger */}
      {tab === "payments" && (
        <div className="mt-6 overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-line bg-surface2 font-semibold text-dim uppercase tracking-wider text-[11px]">
              <tr>
                <th className="p-3.5">Business</th>
                <th className="p-3.5">Plan / Cycle</th>
                <th className="p-3.5">Amount</th>
                <th className="p-3.5">Phone</th>
                <th className="p-3.5">Status</th>
                <th className="p-3.5">M-Pesa Receipt</th>
                <th className="p-3.5">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {payments.map((p) => (
                <tr key={p.id} className="hover:bg-surface2/60 transition">
                  <td className="p-3.5 font-bold">
                    {p.business_name}
                    <div className="font-mono text-[11px] font-normal text-dim">{p.business_slug}</div>
                  </td>
                  <td className="p-3.5">
                    <span className="font-semibold">{p.plan_name}</span> ({p.cycle})
                  </td>
                  <td className="p-3.5 font-bold text-plum">{money(p.amount)}</td>
                  <td className="p-3.5 font-mono">{p.phone}</td>
                  <td className="p-3.5">
                    <span
                      className={`rounded-lg px-2 py-0.5 text-[11px] font-bold ${
                        p.status === "success"
                          ? "bg-good/15 text-good"
                          : p.status === "pending"
                          ? "bg-brand/15 text-brand"
                          : "bg-bad/15 text-bad"
                      }`}
                    >
                      {p.status}
                    </span>
                  </td>
                  <td className="p-3.5 font-mono font-bold text-ink">
                    {p.mpesa_receipt || <span className="text-dim">—</span>}
                  </td>
                  <td className="p-3.5 text-dim">
                    {new Date(p.created_at).toLocaleString("en-KE", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </td>
                </tr>
              ))}
              {payments.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-dim">
                    No M-Pesa payments recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Tenant Management Modal */}
      {editingBiz && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg rounded-3xl border border-line bg-surface p-6 shadow-xl animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div>
                <h2 className="font-display text-lg font-bold">Manage Salon</h2>
                <p className="text-xs text-dim">{editingBiz.name} ({editingBiz.slug})</p>
              </div>
              <button
                onClick={() => setEditingBiz(null)}
                className="text-dim hover:text-bad font-bold text-lg"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveBiz} className="mt-4 space-y-4 text-xs">
              {/* Change Plan */}
              <div>
                <label className="font-bold text-dim uppercase">Plan Tier</label>
                <select
                  value={editPlan}
                  onChange={(e) => setEditPlan(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-line bg-surface2 px-3 py-2 text-sm outline-none focus:border-brand"
                >
                  <option value="starter">Starter (4 staff · KSh 299/mo)</option>
                  <option value="growth">Growth (8 staff · KSh 499/mo)</option>
                  <option value="business">Business (15 staff · KSh 799/mo)</option>
                  <option value="pro">Pro (20+ staff · KSh 1,299/mo)</option>
                </select>
              </div>

              {/* Reset Owner PIN */}
              <div>
                <label className="font-bold text-dim uppercase">Owner Access PIN (4-8 digits)</label>
                <input
                  value={editPin}
                  onChange={(e) => setEditPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
                  className="mt-1 w-full rounded-xl border border-line bg-surface2 px-3 py-2 font-mono text-sm tracking-widest outline-none focus:border-brand"
                  required
                />
              </div>

              {/* Extend Free Trial */}
              <div className="rounded-xl border border-line bg-surface2 p-3">
                <div className="font-bold text-ink">Extend Free Trial</div>
                <div className="mt-2 flex gap-2">
                  {[7, 14, 30].map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setTrialDaysAdd(trialDaysAdd === d ? 0 : d)}
                      className={`flex-1 rounded-lg border py-1.5 font-bold transition ${
                        trialDaysAdd === d
                          ? "border-brand bg-brand/10 text-brand"
                          : "border-line bg-surface hover:border-brand"
                      }`}
                    >
                      +{d} Days
                    </button>
                  ))}
                </div>
              </div>

              {/* Grant Paid Subscription Time */}
              <div className="rounded-xl border border-line bg-surface2 p-3">
                <div className="font-bold text-ink">Grant Paid Subscription Time</div>
                <div className="mt-2 flex gap-2">
                  {[30, 90, 365].map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setPaidDaysAdd(paidDaysAdd === d ? 0 : d)}
                      className={`flex-1 rounded-lg border py-1.5 font-bold transition ${
                        paidDaysAdd === d
                          ? "border-good bg-good/10 text-good"
                          : "border-line bg-surface hover:border-good"
                      }`}
                    >
                      +{d === 365 ? "1 Year" : `${d / 30} Mo`}
                    </button>
                  ))}
                </div>
              </div>

              {actionMsg && (
                <div className="rounded-xl bg-surface2 p-2.5 text-center font-bold text-brand">
                  {actionMsg}
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingBiz(null)}
                  className="flex-1 rounded-xl border border-line py-2.5 font-semibold text-dim hover:border-bad"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 rounded-xl bg-plum py-2.5 font-bold text-white hover:bg-[#4d2f48] disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
