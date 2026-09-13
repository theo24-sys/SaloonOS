"use client";

import { useCallback, useEffect, useState } from "react";
import { api, Bill } from "@/lib/api";
import { Receipt } from "@/app/receipt";
import { MpesaTrustStrip } from "@/app/mpesa";

export default function VerifyBill({ params }: { params: Promise<{ code: string }> }) {
  const [code, setCode] = useState<string | null>(null);
  const [bill, setBill] = useState<Bill | null>(null);
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [confirmStep, setConfirmStep] = useState(false);
  const [err, setErr] = useState("");
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    params.then((p) => setCode(p.code));
  }, [params]);

  const load = useCallback((c: string) => {
    setLoadError("");
    api.getBill(c).then(setBill).catch((error) => {
      const message = error instanceof Error ? error.message : "Unable to load this bill";
      if (message.toLowerCase().includes("not found")) setNotFound(true);
      else setLoadError(message);
    });
  }, []);

  useEffect(() => {
    if (code) load(code);
  }, [code, load]);

  async function verify(dispute: boolean) {
    if (!bill) return;
    setConfirming(true);
    setErr("");
    try {
      const updated = await api.verify(bill.code, dispute, note);
      setBill(updated);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setConfirming(false);
    }
  }

  if (notFound)
    return (
      <main className="mx-auto max-w-md px-5 py-20 text-center">
        <div className="text-4xl">✦</div>
        <h1 className="font-display mt-3 text-2xl font-bold">Bill not found</h1>
        <p className="mt-2 text-sm text-dim">
          Check the link or ask at the counter for your receipt reference.
        </p>
      </main>
    );

  if (loadError)
    return (
      <main className="mx-auto max-w-md px-5 py-20 text-center">
        <div className="text-4xl">⚠</div>
        <h1 className="font-display mt-3 text-2xl font-bold">Receipt temporarily unavailable</h1>
        <p className="mt-2 text-sm text-dim">{loadError}</p>
        <button onClick={() => code && load(code)} className="mt-5 rounded-xl bg-plum px-5 py-3 text-sm font-bold text-white">
          Try again
        </button>
      </main>
    );

  if (!bill)
    return (
      <main className="mx-auto max-w-md px-5 py-24 text-center text-dim">
        <div className="floaty text-4xl">✦</div>
        <p className="mt-3 animate-pulse text-sm">Loading your bill…</p>
      </main>
    );

  const brand = bill.business;
  const pending = bill.status === "pending";
  const shareText = encodeURIComponent(
    `✦ ${brand.name}\nThank you for visiting us ♡\nYour verified receipt is ready.\nReceipt #${bill.code}\nTotal: KSh ${bill.total.toLocaleString()}\n${typeof window !== "undefined" ? window.location.origin : ""}/r/${bill.code}`
  );

  return (
    <main className="mx-auto max-w-md px-4 py-8">
      {pending ? (
        <>
          <Receipt branding={brand} bill={bill} variant="verify" />

          {confirmStep ? (
            <div className="card mt-5 p-4 text-center">
              <p className="text-sm font-semibold">Are you sure? This confirms you saw these prices.</p>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => setConfirmStep(false)}
                  className="flex-1 rounded-xl border border-line px-4 py-2.5 text-sm font-semibold text-dim"
                >
                  Go back
                </button>
                <button
                  onClick={() => verify(false)}
                  disabled={confirming}
                  className="flex-1 rounded-xl bg-plum px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
                >
                  {confirming ? "Confirming…" : "Yes, confirm"}
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              <p className="text-center text-sm font-medium text-ink">
                Does everything look correct?
              </p>
              <button
                onClick={() => setConfirmStep(true)}
                className="w-full rounded-2xl bg-plum px-4 py-4 text-base font-bold tracking-wide text-white shadow-[0_12px_30px_-12px_rgba(93,58,88,0.6)] transition hover:bg-[#4d2f48] active:scale-[0.99]"
              >
                YES, CONFIRM
              </button>
              <div className="flex gap-2">
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Something wrong? Tell us (optional)…"
                  className="min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 py-2.5 text-sm outline-none focus:border-brand"
                />
                <button
                  onClick={() => verify(true)}
                  disabled={confirming}
                  className="rounded-xl border border-line bg-surface px-4 py-2.5 text-sm font-semibold text-bad disabled:opacity-50"
                >
                  Report an issue
                </button>
              </div>
              {err && <p className="text-center text-sm text-bad">{err}</p>}
            </div>
          )}
          <MpesaTrustStrip note="Paying by M-Pesa? Your payment is approved by you, on your own phone." />
        </>
      ) : (
        <>
          <Receipt branding={brand} bill={bill} variant="receipt" />

          {(bill.status === "approved" || bill.status === "paid") && (
            <div className="mt-5 space-y-3">
              <div className="card p-4 text-center">
                <p className="font-display text-xl">Thank you, {bill.customer_name.split(" ")[0]}! <span className="text-brand">♡</span></p>
                <p className="mt-1 text-xs text-dim">
                  {bill.status === "paid"
                    ? "Payment received — see you next time."
                    : "Your bill is verified. Payment is being recorded at the counter."}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <a
                  href={`/r/${bill.code}`}
                  className="rounded-2xl border border-line bg-surface px-4 py-3 text-center text-sm font-bold text-plum"
                >
                  View receipt
                </a>
                <button
                  onClick={() => window.print()}
                  className="rounded-2xl bg-plum px-4 py-3 text-sm font-bold text-white"
                >
                  Download PDF
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <a
                  href={`https://wa.me/?text=${shareText}`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-2xl border border-line bg-surface px-4 py-3 text-center text-sm font-semibold text-good"
                >
                  Send to WhatsApp
                </a>
                <a
                  href={`sms:?&body=${shareText}`}
                  className="rounded-2xl border border-line bg-surface px-4 py-3 text-center text-sm font-semibold text-info"
                >
                  Send SMS
                </a>
              </div>
              <p className="text-center text-[11px] text-dim">
                The receipt link opens a page anyone can verify as genuine.
              </p>
              <MpesaTrustStrip note={bill.payment_method?.includes("M-Pesa") ? `Paid via M-Pesa${bill.payment_ref ? ` · receipt ${bill.payment_ref}` : ""} — confirmed by Safaricom.` : "M-Pesa payments are confirmed by Safaricom with an SMS receipt."} />
            </div>
          )}

          {bill.status === "disputed" && (
            <div className="card mt-5 p-4 text-center text-sm">
              <p className="font-semibold text-bad">⚠ You reported an issue</p>
              {bill.dispute_note && <p className="mt-1 text-dim">“{bill.dispute_note}”</p>}
              <p className="mt-2 text-xs text-dim">The salon will resolve it with you at the counter.</p>
            </div>
          )}
        </>
      )}
    </main>
  );
}
