import Link from "next/link";

const steps = [
  "Customer gets service",
  "Staff creates the bill",
  "Customer scans the QR",
  "Customer checks service + price + total",
  "✓ Approved",
  "Payment",
  "Verified receipt",
  "Owner dashboard",
];

export default function Home() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-10">
      <img
        src="/logo-full.png"
        alt="SaloonOS — Manage · Verify · Grow"
        className="mx-auto w-full max-w-[19rem]"
      />
      <h1 className="font-display mt-6 text-4xl font-bold leading-tight">
        Stop guessing what your staff are charging customers.
      </h1>
      <p className="mt-3 text-dim">
        Staff create the bill after service. The customer scans a QR and approves it on their
        own phone. The owner sees exactly what was sold, what customers verified — and
        <span className="font-display italic text-plum"> where the money went.</span>
      </p>

      <div className="mt-6 flex gap-3">
        <Link
          href="/signup"
          className="rounded-xl bg-plum px-5 py-3 font-bold text-white shadow-[0_12px_30px_-12px_rgba(93,58,88,0.6)] transition hover:bg-[#4d2f48]"
        >           Start 7-day free trial
        </Link>
        <Link href="/pricing" className="rounded-xl border border-line bg-surface px-5 py-3 font-bold hover:border-dim">
          See pricing
        </Link>
      </div>

      <div className="mt-8 rounded-2xl border border-line bg-surface p-5">
        <div className="text-xs font-bold uppercase tracking-[0.3em] text-dim">The whole product</div>
        <ol className="mt-3 space-y-1.5 text-sm">
          {steps.map((s, i) => (
            <li key={s} className="flex items-center gap-3">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-surface2 text-xs font-bold text-brand">
                {i + 1}
              </span>
              {s}
            </li>
          ))}
        </ol>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-line bg-surface p-4">
          <div className="text-xl">🔐</div>
          <div className="mt-1 font-bold">Customer-verified bills</div>
          <p className="mt-1 text-sm text-dim">The customer confirms on their phone. No account, no app.</p>
        </div>
        <div className="rounded-2xl border border-line bg-surface p-4">
          <div className="text-xl">🧾</div>
          <div className="mt-1 font-bold">Proof, not promises</div>
          <p className="mt-1 text-sm text-dim">A verified receipt with a reference the customer keeps.</p>
        </div>
        <div className="rounded-2xl border border-line bg-surface p-4">
          <div className="text-xl">🚨</div>
          <div className="mt-1 font-bold">Leak detection</div>
          <p className="mt-1 text-sm text-dim">Verified but unpaid? The dashboard flags the variance.</p>
        </div>
      </div>
    </main>
  );
}
