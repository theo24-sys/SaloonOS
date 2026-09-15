"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { api, Bill, BillItem, Catalog, money, store } from "@/lib/api";
import { Badge } from "@/app/receipt";
import { BrandLoader } from "@/app/loading-state";

function BillLines({ items, total }: { items: BillItem[]; total: number }) {
  return (
    <div className="mt-3">
      {items.map((it, i) => (
        <div key={i} className="flex justify-between border-b border-dashed border-line py-2 text-sm">
          <span>{it.name}</span>
          <span>{money(it.price)}</span>
        </div>
      ))}
      <div className="flex justify-between pt-3 text-lg font-extrabold">
        <span>TOTAL</span>
        <span>{money(total)}</span>
      </div>
    </div>
  );
}

export default function StaffApp() {
  const [cat, setCat] = useState<Catalog | null>(null);
  const [customer, setCustomer] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [staffId, setStaffId] = useState<number | "">("");
  const [items, setItems] = useState<BillItem[]>([{ name: "", price: 0 }, { name: "", price: 0 }]);
  const [bill, setBill] = useState<Bill | null>(null);
  const [err, setErr] = useState("");
  const [toast, setToast] = useState("");
  const [invite, setInvite] = useState<{ code: string; name: string } | null>(null);
  const [inviteMsg, setInviteMsg] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [invitePin, setInvitePin] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanCode, setScanCode] = useState("");
  const [scanErr, setScanErr] = useState("");
  const [switchOpen, setSwitchOpen] = useState(false);
  const [switchSlug, setSwitchSlug] = useState("");
  const [authReady, setAuthReady] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(() => {
    api.catalog(store.slug).then((c) => {
      setCat(c);
      setErr("");
      setStaffId((s) => s || c.staff[0]?.id || "");
    }).catch((e) => {
      setCat(null);
      setErr(e.message);
    });
  }, []);
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  // Staff invite links (/app?invite=CODE) bind this device to the salon.
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("invite");
    if (!code) {
      if (store.staffToken || store.pin) {
        load();
      } else {
        setInviteMsg("Staff access is invite-only. Ask your salon owner for your invite link.");
      }
      setAuthReady(true);
      return;
    }
    setInviteCode(code);
    setAuthReady(true);
  }, [load]);

  async function acceptInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteBusy(true);
    setInviteMsg("");
    try {
      const r = await api.inviteAccept(inviteCode, invitePin);
      store.slug = r.business.slug;
      store.staffToken = r.token;
      setInvite({ code: inviteCode, name: r.staff.name });
      setInviteMsg(`Welcome, ${r.staff.name} — you're signed in to ${r.business.name}.`);
      window.history.replaceState({}, "", "/app");
      load();
    } catch (e) {
      setInviteMsg((e as Error).message);
    } finally {
      setInviteBusy(false);
    }
  }

  const total = items.reduce((s, it) => s + (Number(it.price) || 0), 0);

  function setItem(i: number, patch: Partial<BillItem>) {
    setItems((arr) => arr.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  }
  function pickService(i: number, name: string) {
    const svc = cat?.services.find((s) => s.name === name);
    setItem(i, { name, price: svc ? svc.default_price : items[i].price });
  }

  async function create() {
    setErr("");
    try {
      const b = await api.createBill(store.slug, {
        customer_name: customer,
        customer_phone: customerPhone,
        staff_id: Number(staffId),
        items: items.filter((it) => it.name.trim()),
      });
      setBill(b);
      setToast("Bill created — show the QR to the customer");
      setTimeout(() => setToast(""), 2500);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  // Poll for customer verification
  useEffect(() => {
    if (!bill || (bill.status !== "pending")) return;
    pollRef.current = setInterval(async () => {
      try {
        const b = await api.getBill(bill.code, store.slug, true);
        if (b.status !== "pending") setBill(b);
      } catch { /* keep polling */ }
    }, 2500);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [bill]);

  async function pay(method: string) {
    if (!bill) return;
    try {
      const b = await api.pay(store.slug, bill.code, method);
      setBill(b);
      setToast("Payment recorded");
      setTimeout(() => setToast(""), 2500);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function confirmScan(e: React.FormEvent) {
    e.preventDefault();
    if (!bill) return;
    setScanErr("");
    try {
      const b = await api.redeemScanBill(store.slug, bill.code, scanCode.trim());
      setBill(b);
      setToast("Scan payment confirmed");
      setScanOpen(false);
      setScanCode("");
      setTimeout(() => setToast(""), 2500);
    } catch (e) {
      setScanErr((e as Error).message);
    }
  }

  function reset() {
    setBill(null);
    setCustomer("");
    setCustomerPhone("");
    setItems([{ name: "", price: 0 }, { name: "", price: 0 }]);
  }

  if (err && !cat) {
    const isUnknownBiz = err.toLowerCase().includes("unknown business") || err.toLowerCase().includes("missing");
    return (
      <main className="mx-auto max-w-md px-5 py-10">
        <div className="rounded-2xl border border-line bg-surface p-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand/10 text-2xl text-plum">
            ✦
          </div>
          <h2 className="font-display text-lg font-bold">
            {isUnknownBiz ? "No Salon Found" : "Connection Error"}
          </h2>
          <p className="mt-1 text-sm text-dim">
            {isUnknownBiz
              ? "Create your business to start issuing customer-verified bills."
              : err}
          </p>
          <div className="mt-6 flex flex-col gap-2">
            <Link href="/" className="rounded-xl bg-plum px-4 py-2.5 font-bold text-white transition hover:bg-[#4d2f48]">
              Return to sign in
            </Link>
          </div>
        </div>
      </main>
    );
  }
  if (inviteCode && !store.staffToken) {
    return (
      <main className="mx-auto max-w-md px-5 py-16">
        <form onSubmit={acceptInvite} className="rounded-3xl border border-line bg-surface p-7 shadow-[0_18px_45px_-28px_rgba(93,58,88,0.45)]">
          <div className="text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#f8e9f0] text-2xl text-plum">✦</div>
            <h1 className="font-display mt-4 text-2xl font-bold">Staff sign in</h1>
            <p className="mt-2 text-sm leading-6 text-dim">Enter the PIN assigned by your salon owner to activate this invite.</p>
          </div>
          <input value={invitePin} onChange={(e) => setInvitePin(e.target.value.replace(/\D/g, "").slice(0, 8))} inputMode="numeric" type="password" placeholder="Staff PIN"
            className="mt-5 w-full rounded-xl border border-line bg-surface2 px-3 py-3 text-center text-xl tracking-[0.4em] outline-none focus:border-brand" autoFocus required minLength={4} />
          {inviteMsg && <p className="mt-2 text-center text-sm text-bad">{inviteMsg}</p>}
          <button disabled={inviteBusy} className="mt-4 w-full rounded-xl bg-plum px-4 py-3 font-bold text-white disabled:opacity-50">
            {inviteBusy ? "Signing in…" : "Open Staff POS"}
          </button>
        </form>
      </main>
    );
  }

  if (!authReady || (!cat && !err)) return <main className="mx-auto max-w-md px-5 py-10 text-dim">Opening Staff POS…</main>;

  if (!cat && !store.staffToken && !store.pin) {
    return (
      <main className="mx-auto max-w-md px-5 py-16">
        <div className="rounded-3xl border border-line bg-surface p-7 text-center shadow-[0_18px_45px_-28px_rgba(93,58,88,0.45)]">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#f8e9f0] text-2xl text-plum">✦</div>
          <h1 className="font-display mt-4 text-2xl font-bold">Staff invite required</h1>
          <p className="mt-2 text-sm leading-6 text-dim">
            Your salon owner should send you a personal SaloonOS invite link. Open that link on this device to sign in.
          </p>
          <Link href="/" className="mt-6 inline-flex rounded-xl bg-plum px-5 py-3 text-sm font-bold text-white">
            Back to SaloonOS
          </Link>
        </div>
      </main>
    );
  }
  if (!cat) return <BrandLoader label="Loading your salon…" />;

  if (cat.subscription.state === "expired") {
    return (
      <main className="staff-lock-screen mx-auto max-w-md px-5 py-16 text-center">
        <div className="staff-lock-mark">🔒</div>
        <p className="mt-5 text-xs font-bold uppercase tracking-[0.22em] text-bad">Staff access paused</p>
        <h1 className="font-display mt-2 text-2xl font-bold">This salon needs activation</h1>
        <p className="mt-3 text-sm leading-6 text-dim">
          Your free trial or subscription has ended. Please contact management to activate the salon before creating or operating bills.
        </p>
        <div className="staff-lock-note mt-5 rounded-2xl border border-warn/30 bg-warn/10 p-4 text-left text-xs leading-5 text-dim">
          <strong className="text-ink">What to do next</strong><br />Ask the owner or manager to renew the salon plan, then reopen this page.
        </div>
        <button onClick={() => window.location.reload()} className="mt-5 rounded-xl bg-plum px-5 py-3 text-sm font-bold text-white">Check access again</button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md px-5 py-6">
      {inviteMsg && (
        <div className={`mb-3 rounded-2xl border p-3 text-sm ${invite ? "border-good/40 bg-good/10 text-ink" : "border-bad/40 bg-bad/10 text-bad"}`}>
          {inviteMsg}
        </div>
      )}
      {!bill ? (
        <>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="font-display text-2xl font-bold">
                New bill <span className="text-base font-medium text-dim">— {cat.business.name}</span>
              </h1>
              <p className="mt-0.5 text-xs text-dim">
                {cat.business.plan.name} plan · {cat.business.plan.monthly_verified_bills} verified bills/mo
              </p>
            </div>
            <button
              onClick={() => {
                setSwitchSlug(store.slug);
                setSwitchOpen(true);
              }}
              className="rounded-lg border border-line bg-surface2 px-2.5 py-1 text-xs font-semibold text-dim hover:border-brand hover:text-ink"
            >
              Switch salon ⇄
            </button>
          </div>

          <div className="mt-4 space-y-3 rounded-2xl border border-line bg-surface p-4">
            <input
              value={customer}
              onChange={(e) => setCustomer(e.target.value)}
              placeholder="Customer name"
              className="w-full rounded-xl border border-line bg-surface2 px-3 py-2.5 outline-none focus:border-brand"
            />
            <input
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              placeholder="Customer phone number (optional)"
              inputMode="tel"
              className="w-full rounded-xl border border-line bg-surface2 px-3 py-2.5 outline-none focus:border-brand"
            />
            <select
              value={staffId}
              onChange={(e) => setStaffId(Number(e.target.value))}
              className="w-full rounded-xl border border-line bg-surface2 px-3 py-2.5 outline-none focus:border-brand"
            >
              {cat.staff.map((s) => (
                <option key={s.id} value={s.id}>Served by: {s.name}</option>
              ))}
            </select>

            <div className="pt-1 text-sm font-bold">Services</div>
            {items.map((it, i) => (
              <div key={i} className="staff-pos-item-row flex gap-2">
                <input
                  list="svcs"
                  value={it.name}
                  onChange={(e) => pickService(i, e.target.value)}
                  placeholder="Service"
                  className="min-w-0 flex-1 rounded-xl border border-line bg-surface2 px-3 py-2.5 text-sm outline-none focus:border-brand"
                />
                <input
                  type="number"
                  min={0}
                  value={it.price || ""}
                  onChange={(e) => setItem(i, { price: Number(e.target.value) })}
                  placeholder="KSh"
                  className="w-24 shrink-0 rounded-xl border border-line bg-surface2 px-3 py-2.5 text-sm outline-none focus:border-brand"
                />
                <button
                  onClick={() => setItems((arr) => arr.filter((_, j) => j !== i))}
                  className="w-9 shrink-0 rounded-xl border border-line text-dim hover:text-bad"
                  aria-label="Remove"
                >✕</button>
              </div>
            ))}
            <datalist id="svcs">
              {cat.services.map((s) => <option key={s.id} value={s.name} />)}
            </datalist>
            <button
              onClick={() => setItems((arr) => [...arr, { name: "", price: 0 }])}
              className="rounded-xl border border-line bg-surface2 px-4 py-2 text-sm font-bold"
            >
              + Add service
            </button>

            <div className="flex items-center justify-between border-t border-line pt-3">
              <span className="text-dim">Total</span>
              <span className="text-lg font-extrabold">{money(total)}</span>
            </div>
            <button
              onClick={create}
              disabled={!customer.trim() || total <= 0}
              className="w-full rounded-xl bg-plum px-4 py-3 font-bold text-white shadow-[0_12px_30px_-12px_rgba(93,58,88,0.6)] transition hover:bg-[#4d2f48] disabled:opacity-40"
            >
              Create bill &amp; show QR
            </button>
          </div>
        </>
      ) : (
        <div className="rounded-2xl border border-line bg-surface p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-extrabold">Bill #{bill.code}</h2>
            <Badge status={bill.status} />
          </div>
          <div className="text-sm text-dim">Customer: {bill.customer_name} · Served by {bill.staff_name}</div>
          <BillLines items={bill.items} total={bill.total} />

          {bill.edits.length > 0 && (
            <div className="mt-2 rounded-xl border border-warn/40 bg-warn/10 p-3 text-xs text-warn">
              {bill.edits.map((e, i) => (
                <div key={i}>
                  ✏️ {e.item_name}: {money(e.old_price)} → {money(e.new_price)} — {e.reason || "no reason"}
                </div>
              ))}
            </div>
          )}

          {bill.status === "pending" && (
            <>
              <div className="mt-4 text-center">
                <Image
                  src={bill.qr_data_url || "/favicon.png"}
                  alt={`QR for bill ${bill.code}`}
                  width={224}
                  height={224}
                  unoptimized={Boolean(bill.qr_data_url)}
                  className="mx-auto w-56 rounded-xl bg-white p-2"
                />
                <div className="mt-2 text-xs text-dim">Customer scans → verifies on their phone</div>
                <div className="mt-3 animate-pulse text-sm font-semibold text-plum">✦ Awaiting customer verification…</div>
              </div>
            </>
          )}

          {bill.status === "approved" && (
            <>
              <div className="mt-4 rounded-xl bg-[#e7f0ea] p-3 text-center font-bold text-good pop">
                ✓ Customer verified this bill
              </div>
              <p className="mt-3 text-center text-xs text-dim">How is the customer paying KSh {bill.total.toLocaleString()}?</p>
              <div className="staff-pos-payment-grid mt-2 grid grid-cols-3 gap-2">
                <button onClick={() => pay("M-Pesa")} className="rounded-xl border-2 border-[#3AA335]/50 bg-[#f4faf5] py-2.5 text-sm font-extrabold text-[#0b6e35] transition hover:border-[#3AA335] hover:bg-[#eaf7ec]">
                  M-Pesa
                </button>
                {["Cash", "Card"].map((m) => (
                  <button key={m} onClick={() => pay(m)} className="rounded-xl border border-line bg-surface2 py-2.5 text-sm font-semibold transition hover:border-plum hover:text-plum">
                    {m}
                  </button>
                ))}
              </div>
              {!scanOpen ? (
                <button onClick={() => setScanOpen(true)} className="mt-2 w-full rounded-xl border border-dashed border-[#3AA335]/50 bg-[#f7fbf8] py-2 text-xs font-semibold text-[#0b6e35]">
                  Customer scanned the merchant QR? Enter the receipt code →
                </button>
              ) : (
                <form onSubmit={confirmScan} className="mt-2 rounded-xl border border-[#3AA335]/40 bg-[#f7fbf8] p-3">
                  <p className="text-xs font-semibold text-[#0b6e35]">Receipt code from the customer&apos;s M-Pesa SMS:</p>
                  <div className="mt-2 flex gap-2">
                    <input value={scanCode} onChange={(e) => setScanCode(e.target.value.toUpperCase())} placeholder="SJ84K2ABCD"
                      className="min-w-0 flex-1 rounded-lg border border-line bg-white px-2.5 py-2 font-mono text-sm uppercase outline-none focus:border-[#3AA335]" />
                    <button disabled={scanCode.trim().length < 8} className="rounded-lg bg-[#3AA335] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Confirm</button>
                  </div>
                  {scanErr && <p className="mt-1.5 text-xs text-bad">{scanErr}</p>}
                  <div className="mt-3 border-t border-[#3AA335]/20 pt-3">
                    <p className="mb-2 text-center text-[11px] font-semibold text-[#3f6b4d]">Customer hasn&apos;t scanned yet? Let them scan here:</p>
                    <div className="flex items-center justify-center gap-3">
                      <Image src="/mpesa-qr.png" alt="M-Pesa scan-to-pay QR" width={112} height={112} className="h-28 w-28 rounded-lg border-2 border-[#3AA335]/40 bg-white p-1.5" />
                      <div className="text-xs text-dim">
                        <p className="font-display text-sm font-bold text-[#0b6e35]">MORGGY TECHNOLOGIES</p>
                        <p className="mt-0.5">Paybill <span className="font-mono font-bold">4567052</span></p>
                        <p className="mt-0.5">or dial <span className="font-mono font-bold">*126#</span></p>
                      </div>
                    </div>
                  </div>
                </form>
              )}
            </>
          )}

          {bill.status === "disputed" && (
            <div className="mt-4 rounded-xl bg-bad/15 p-3 text-center font-bold text-bad">
              ⚠️ Disputed: {bill.dispute_note || "no details"}
            </div>
          )}

          {bill.status === "paid" && (
            <div className="mt-4 rounded-xl bg-[#ece7f6] p-3 text-center font-bold text-info pop">
              ✓ {money(bill.total)} recorded — {bill.payment_method}
            </div>
          )}

          <button onClick={reset} className="mt-4 w-full rounded-xl border border-line bg-surface2 py-2.5 text-sm font-bold">
            {bill.status === "paid" ? "Next customer" : "Back"}
          </button>
        </div>
      )}

      {switchOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-xl">
            <h3 className="font-display font-bold text-base">Switch Salon</h3>
            <p className="mt-1 text-xs text-dim">
              Enter your salon&apos;s unique slug identifier (e.g. <code className="font-mono">treezy</code> or <code className="font-mono">xyz-salon</code>).
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const slug = switchSlug.trim().toLowerCase();
                if (!slug) return;
                store.slug = slug;
                store.staffToken = "";
                setSwitchOpen(false);
                load();
              }}
              className="mt-4 space-y-3"
            >
              <input
                value={switchSlug}
                onChange={(e) => setSwitchSlug(e.target.value)}
                placeholder="e.g. treezy"
                className="w-full rounded-xl border border-line bg-surface2 px-3 py-2 text-sm outline-none focus:border-brand"
                required
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setSwitchOpen(false)}
                  className="flex-1 rounded-xl border border-line py-2 text-xs font-semibold text-dim"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 rounded-xl bg-plum py-2 text-xs font-bold text-white hover:bg-[#4d2f48]"
                >
                  Open Salon
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-xl border border-line bg-surface2 px-4 py-2 text-sm font-bold shadow-lg">
          {toast}
        </div>
      )}
      {err && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-xl border border-bad bg-bad/15 px-4 py-2 text-sm font-bold text-bad shadow-lg" onClick={() => setErr("")}>
          {err}
        </div>
      )}
    </main>
  );
}
