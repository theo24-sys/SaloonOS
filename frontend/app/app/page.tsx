"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, Bill, BillItem, Catalog, money, store } from "@/lib/api";
import { Badge } from "@/app/receipt";
import { MpesaScanTile } from "@/app/mpesa";

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
  const [staffId, setStaffId] = useState<number | "">("");
  const [items, setItems] = useState<BillItem[]>([{ name: "", price: 0 }, { name: "", price: 0 }]);
  const [bill, setBill] = useState<Bill | null>(null);
  const [err, setErr] = useState("");
  const [toast, setToast] = useState("");
  const [invite, setInvite] = useState<{ code: string; name: string } | null>(null);
  const [inviteMsg, setInviteMsg] = useState("");
  const [scanOpen, setScanOpen] = useState(false);
  const [scanCode, setScanCode] = useState("");
  const [scanErr, setScanErr] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(() => {
    api.catalog(store.slug).then((c) => {
      setCat(c);
      setStaffId((s) => s || c.staff[0]?.id || "");
    }).catch((e) => setErr(e.message));
  }, []);
  useEffect(load, [load]);
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  // Staff invite links (/app?invite=CODE) bind this device to the salon.
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("invite");
    if (!code) return;
    api.inviteAccept(code)
      .then((r) => {
        store.slug = r.business.slug;
        setInvite({ code, name: r.staff.name });
        setInviteMsg(`Welcome, ${r.staff.name} — you're signed in to ${r.business.name}.`);
        window.history.replaceState({}, "", "/app");
        load();
      })
      .catch((e) => setInviteMsg(e.message));
  }, [load]);

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
    setItems([{ name: "", price: 0 }, { name: "", price: 0 }]);
  }

  if (err && !cat) {
    return (
      <main className="mx-auto max-w-md px-5 py-10">
        <div className="rounded-2xl border border-bad/40 bg-bad/10 p-5 text-bad">{err}</div>
      </main>
    );
  }
  if (!cat) return <main className="mx-auto max-w-md px-5 py-10 text-dim">Loading…</main>;

  return (
    <main className="mx-auto max-w-md px-5 py-6">
      {inviteMsg && (
        <div className={`mb-3 rounded-2xl border p-3 text-sm ${invite ? "border-good/40 bg-good/10 text-ink" : "border-bad/40 bg-bad/10 text-bad"}`}>
          {inviteMsg}
        </div>
      )}
      {!bill ? (
        <>
          <h1 className="font-display text-2xl font-bold">New bill <span className="text-base font-medium text-dim">— {cat.business.name}</span></h1>
          <p className="mt-0.5 text-xs text-dim">
            {cat.business.plan.name} plan · {cat.business.plan.monthly_verified_bills} verified bills/mo
          </p>

          <div className="mt-4 space-y-3 rounded-2xl border border-line bg-surface p-4">
            <input
              value={customer}
              onChange={(e) => setCustomer(e.target.value)}
              placeholder="Customer name"
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
              <div key={i} className="flex gap-2">
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
                <img src={bill.qr_data_url} alt={`QR for bill ${bill.code}`} className="mx-auto w-56 rounded-xl bg-white p-2" />
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
              <div className="mt-2 grid grid-cols-3 gap-2">
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
                      <img src="/mpesa-qr.png" alt="M-Pesa scan-to-pay QR" className="h-28 w-28 rounded-lg border-2 border-[#3AA335]/40 bg-white p-1.5" />
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
