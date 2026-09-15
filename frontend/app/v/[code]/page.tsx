"use client";

import { useCallback, useEffect, useState } from "react";
import { api, Bill } from "@/lib/api";
import { Receipt } from "@/app/receipt";
import { MpesaTrustStrip } from "@/app/mpesa";
import { BrandLoader, VerificationSeal } from "@/app/loading-state";

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
      <main className="verify-page verify-empty mx-auto max-w-xl px-5 py-20 text-center">
        <div className="verify-empty-mark">✦</div>
        <h1 className="font-display mt-3 text-2xl font-bold">Bill not found</h1>
        <p className="mt-2 text-sm text-dim">
          Check the link or ask at the counter for your receipt reference.
        </p>
      </main>
    );

  if (loadError)
    return (
      <main className="verify-page verify-empty mx-auto max-w-xl px-5 py-20 text-center">
        <div className="verify-empty-mark is-error">!</div>
        <h1 className="font-display mt-3 text-2xl font-bold">Receipt temporarily unavailable</h1>
        <p className="mt-2 text-sm text-dim">{loadError}</p>
        <button onClick={() => code && load(code)} className="verify-retry mt-5 rounded-xl bg-plum px-5 py-3 text-sm font-bold text-white">
          Try again
        </button>
      </main>
    );

  if (!bill)
      return <BrandLoader label="Checking your salon bill…" />;

  const brand = bill.business;
  const pending = bill.status === "pending";
  const shareText = encodeURIComponent(
    `✦ ${brand.name}\nThank you for visiting us ♡\nYour verified receipt is ready.\nReceipt #${bill.code}\nTotal: KSh ${bill.total.toLocaleString()}\n${typeof window !== "undefined" ? window.location.origin : ""}/r/${bill.code}`
  );

  return (
    <main className="verify-page mx-auto max-w-xl px-4 py-6 sm:py-10">
      <header className="verify-page-header">
        <div className="verify-page-brand-mark">✓</div>
        <div>
          <p className="verify-kicker">Customer verification</p>
          <p className="verify-page-title">Review your visit</p>
        </div>
        <span className="verify-live-status"><i /> Live</span>
      </header>
      {pending ? (
        <>
          <div className="verify-receipt-card"><Receipt branding={brand} bill={bill} variant="verify" /></div>

          {confirmStep ? (
            <div className="verify-action-panel mt-5 p-5 text-center">
              <p className="verify-action-kicker">One last check</p>
              <p className="mt-1 text-base font-semibold">Are these services and prices correct?</p>
              <p className="mt-1 text-xs text-dim">Your confirmation becomes part of this receipt&apos;s record.</p>
              <div className="mt-4 flex gap-2">
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
            <div className="verify-action-panel mt-5 space-y-3 p-5">
              <div className="text-center"><p className="verify-action-kicker">Your approval</p><p className="mt-1 text-base font-semibold">Does everything look correct?</p><p className="mt-1 text-xs text-dim">Confirm only after checking each service above.</p></div>
              <button
                onClick={() => setConfirmStep(true)}
                className="verify-confirm-button w-full rounded-2xl bg-plum px-4 py-4 text-base font-bold tracking-wide text-white shadow-[0_12px_30px_-12px_rgba(93,58,88,0.6)] transition hover:bg-[#4d2f48] active:scale-[0.99]"
              >
                Confirm this bill <span aria-hidden>✓</span>
              </button>
              <div className="verify-dispute-row flex gap-2">
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
          <div className="verify-receipt-card is-complete"><Receipt branding={brand} bill={bill} variant="receipt" /></div>

          {(bill.status === "approved" || bill.status === "paid") && (
            <div className="mt-5 space-y-3">
              <div className="verify-success-card card p-4 text-center">
                <VerificationSeal />
                <p className="mt-2 font-display text-xl">Thank you, {bill.customer_name.split(" ")[0]}! <span className="text-brand">♡</span></p>
                <p className="mt-1 text-xs text-dim">
                  {bill.status === "paid"
                    ? "Payment received — see you next time."
                    : "Your bill is verified. Payment is being recorded at the counter."}
                </p>
                {brand.thank_you && <p className="mt-3 border-t border-[#d4e7d7] pt-3 text-sm italic text-good">{brand.thank_you}</p>}
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
