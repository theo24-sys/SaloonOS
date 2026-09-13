import Link from "next/link";

export default function PrivacyPolicy() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-10">
      <Link href="/" className="text-xs font-semibold text-dim hover:text-ink">
        ← Back to home
      </Link>
      <h1 className="mt-4 font-display text-3xl font-bold">Privacy Policy</h1>
      <p className="mt-1 text-xs text-dim">Last updated: September 2026 · Morggy Technologies</p>

      <div className="mt-6 space-y-6 text-sm text-ink/90 leading-relaxed">
        <section>
          <h2 className="font-display text-lg font-bold text-ink">1. Information We Collect</h2>
          <p className="mt-2 text-dim">
            SaloonOS, operated by <strong>Morggy Technologies</strong>, collects minimal information required to provide customer-verified billing services. This includes business name, staff names, service pricing catalogs, bill items, customer phone numbers (when provided for M-Pesa payments or receipts), and immutable transaction audit logs.
          </p>
        </section>

        <section>
          <h2 className="font-display text-lg font-bold text-ink">2. How We Use Information</h2>
          <p className="mt-2 text-dim">
            We use this data strictly to:
          </p>
          <ul className="mt-2 list-disc pl-5 space-y-1 text-dim">
            <li>Generate customer verification QR codes and authentic receipts.</li>
            <li>Process and reconcile payments via Safaricom M-Pesa.</li>
            <li>Provide salon owners with revenue tracking, leak detection, and audit histories.</li>
            <li>Maintain platform reliability, security, and dispute resolution.</li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-lg font-bold text-ink">3. Data Security & Storage</h2>
          <p className="mt-2 text-dim">
            All audit events are stored securely in protected databases. Financial transactions, verification timestamps, and bill modifications cannot be altered or purged after recording.
          </p>
        </section>

        <section>
          <h2 className="font-display text-lg font-bold text-ink">4. Third-Party Services</h2>
          <p className="mt-2 text-dim">
            Payment transactions are processed through Safaricom Daraja M-Pesa APIs. We do not store PINs or mobile banking credentials.
          </p>
        </section>

        <section>
          <h2 className="font-display text-lg font-bold text-ink">5. Contact Information</h2>
          <p className="mt-2 text-dim">
            If you have questions regarding this Privacy Policy, please contact Morggy Technologies:
          </p>
          <div className="mt-2 rounded-xl border border-line bg-surface p-4 text-xs space-y-1">
            <p><strong>Morggy Technologies</strong></p>
            <p className="text-dim">Location: Juja, Nairobi, Kenya</p>
            <p className="text-dim">Phone / WhatsApp: <a href="tel:0714042946" className="text-plum font-semibold">0714042946</a></p>
          </div>
        </section>
      </div>
    </main>
  );
}
