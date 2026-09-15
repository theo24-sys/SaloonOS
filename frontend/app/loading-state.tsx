"use client";

import Image from "next/image";

export function BrandLoader({ label = "Opening your salon experience…" }: { label?: string }) {
  return (
    <main className="brand-loader" role="status" aria-live="polite">
      <div className="brand-loader-mark">
        <Image src="/favicon.png" alt="" width={48} height={48} priority />
        <span />
      </div>
      <p className="brand-loader-name"><span>Saloon</span><em>OS</em></p>
      <p className="brand-loader-label">{label}</p>
    </main>
  );
}

export function VerificationSeal() {
  return (
    <div className="verification-seal" aria-label="Customer verified">
      <svg viewBox="0 0 52 52" aria-hidden="true">
        <circle className="verification-seal-ring" cx="26" cy="26" r="22" />
        <path className="verification-seal-check" d="m15 27 7 7 15-17" />
      </svg>
    </div>
  );
}
