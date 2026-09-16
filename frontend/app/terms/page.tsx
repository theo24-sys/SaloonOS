import Link from "next/link";

export default function TermsOfService() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-10">
      <Link href="/" className="text-xs font-semibold text-dim hover:text-ink">
        ← Back to home
      </Link>
      <h1 className="mt-4 font-display text-3xl font-bold">Terms of Service</h1>
      <p className="mt-1 text-xs text-dim">Last updated: 16 September 2026 · Morggy Technologies</p>

      <div className="mt-6 space-y-6 text-sm text-ink/90 leading-relaxed">
        <section>
          <h2 className="font-display text-lg font-bold text-ink">1. Acceptance of Terms</h2>
          <p className="mt-2 text-dim">
            By creating an account, accessing, or using SaloonOS (&ldquo;the Service&rdquo;), provided by <strong>Morggy Technologies</strong>, you agree to comply with and be bound by these Terms of Service.
          </p>
        </section>

        <section>
          <h2 className="font-display text-lg font-bold text-ink">2. Description of Service</h2>
          <p className="mt-2 text-dim">
            SaloonOS provides digital point-of-sale billing, customer QR verification, payment-method selection, payment recording, digital receipts, staff access management, and business management tools for salons, barbershops, and beauty service providers. Customer approval verifies the bill; staff must still record when payment is received.
          </p>
        </section>

        <section>
          <h2 className="font-display text-lg font-bold text-ink">3. Subscription & Billing</h2>
          <p className="mt-2 text-dim">
            New accounts receive a 7-day free trial. Following the trial period, continuous access requires an active subscription plan (Starter, Growth, Business, or Pro) billed monthly or annually in Kenya Shillings (KSh) via M-Pesa.
          </p>
        </section>

        <section>
          <h2 className="font-display text-lg font-bold text-ink">4. Customer Verification & Immutable Audit</h2>
          <p className="mt-2 text-dim">
            SaloonOS enforces customer bill verification before payment can be recorded. All bill modifications, verifications, disputes, payment events, and access changes are logged in an immutable audit ledger to prevent unauthorized tampering. Historical bills are retained when staff access is revoked.
          </p>
        </section>

        <section>
          <h2 className="font-display text-lg font-bold text-ink">5. Electronic Contract Acceptance</h2>
          <p className="mt-2 text-dim">
            By creating an account, selecting a plan, or using SaloonOS, the account owner confirms acceptance of these Terms and the Privacy Policy for the business they represent. Morggy Technologies may also provide a separate service, partner, or salon agreement for electronic or written signature. A signed agreement forms part of the contract between the parties and controls over these general terms where the documents conflict.
          </p>
        </section>

        <section>
          <h2 className="font-display text-lg font-bold text-ink">6. Support & Inquiries</h2>
          <p className="mt-2 text-dim">
            For support, custom plans, or questions regarding these terms, reach out directly:
          </p>
          <div className="mt-2 rounded-xl border border-line bg-surface p-4 text-xs space-y-1">
            <p><strong>Morggy Technologies</strong></p>
            <p className="text-dim">Juja, Nairobi, Kenya</p>
            <p className="text-dim">Email: <a href="mailto:morggytechnologies@gmail.com" className="text-plum font-semibold">morggytechnologies@gmail.com</a></p>
            <p className="text-dim">Tel: <a href="tel:0714042946" className="text-plum font-semibold">0714042946</a></p>
          </div>
        </section>
      </div>
    </main>
  );
}
