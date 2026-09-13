"use client";

import Image from "next/image";

export const MPESA_GREEN = "#35b956";

export function MpesaTrustStrip({ note }: { note?: string }) {
  return (
    <div className="mpesa-trust-strip">
      <div className="mpesa-brand-lockup"><span className="mpesa-mark">M</span><div><strong>M-PESA</strong><small>by Safaricom</small></div></div>
      <div className="mpesa-trust-copy"><p><span className="trust-check">✓</span> Secure mobile payment</p><small>{note || "You approve every payment on your phone. Your M-Pesa PIN stays private."}</small></div>
      <div className="mpesa-secure-badge">Daraja<br /><span>protected</span></div>
    </div>
  );
}

export function MpesaScanTile({ compact }: { compact?: boolean }) {
  return (
    <section className={`mpesa-sticker-card ${compact ? "is-compact" : ""}`}>
      <div className="mpesa-sticker-header"><div><span className="sticker-kicker">Alternative payment</span><h2>Scan. Pay. Done.</h2><p>Use your M-Pesa app to pay with the official Safaricom sticker.</p></div><span className="scan-icon" aria-hidden>⌁</span></div>
      <div className="mpesa-sticker-content">
        <div className="sticker-frame"><Image src="/qr-sticker.png" alt="Safaricom M-Pesa scan-to-pay sticker for Morggy Technologies, Buy Goods Till Number 4567052" width={2105} height={1489} className="sticker-image" /></div>
        <div className="sticker-details"><div className="detail-step"><span>01</span><div><strong>Open M-Pesa</strong><small>Tap Scan QR in the app, or dial <b>*126#</b>.</small></div></div><div className="detail-step"><span>02</span><div><strong>Scan the sticker</strong><small>Confirm the merchant is <b>Morggy Technologies</b>.</small></div></div><div className="detail-step"><span>03</span><div><strong>Enter your PIN</strong><small>Use Buy Goods Till <b>4567052</b> and keep the SMS receipt.</small></div></div><div className="till-callout"><small>BUY GOODS TILL NUMBER</small><strong>4567052</strong><span>MORGGY TECHNOLOGIES</span></div></div>
      </div>
      <div className="mpesa-sticker-footer"><span className="safaricom-dot" /> Payments processed securely over Safaricom M-Pesa <span className="footer-divider">·</span> Receipt issued for every transaction</div>
    </section>
  );
}
