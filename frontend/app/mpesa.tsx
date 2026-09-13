"use client";

import Image from "next/image";

/* Shared M-Pesa trust components — Safaricom green (#3AA335), official
   merchant sticker QR (Paybill 4567052 · Morggy Technologies). */

export const MPESA_GREEN = "#3AA335";

export function MpesaTrustStrip({ note }: { note?: string }) {
  return (
    <div className="mt-4 overflow-hidden rounded-2xl border border-[#3AA335]/30 bg-gradient-to-r from-[#eaf7ec] via-[#f2faf3] to-[#e8f6ea] p-3">
      <div className="flex items-center gap-3">
        <Image src="/mpesa-logo.png" alt="M-Pesa" width={36} height={36} className="h-9 w-9 rounded-lg border border-[#3AA335]/25 bg-white p-1" />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-sm font-bold text-[#0b6e35]">
            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-[#3AA335] text-[10px] text-white">✓</span>
            Secured by M-Pesa
          </p>
          <p className="text-[11px] leading-snug text-[#3f6b4d]">
            {note || "Official Safaricom Daraja payments · every payment approved on your phone"}
          </p>
        </div>
      </div>
    </div>
  );
}

export function MpesaScanTile({ compact }: { compact?: boolean }) {
  return (
    <div className="mt-4 overflow-hidden rounded-2xl border border-[#3AA335]/35 bg-surface">
      <div className="flex items-center gap-2 bg-[#3AA335] px-4 py-2.5">
        <span className="text-lg">📱</span>
        <div>
          <p className="text-sm font-extrabold uppercase tracking-[0.18em] text-white">Scan to pay</p>
          <p className="text-[11px] text-[#e2f5e5]">Lipa na Bonga via MY ONEAPP — or dial <span className="font-mono font-bold">*126#</span></p>
        </div>
      </div>
      <div className="flex flex-col items-center gap-4 p-5 sm:flex-row sm:items-center">
        <div className={`rounded-2xl border-2 border-[#3AA335]/40 bg-white p-2 shadow-[0_12px_30px_-18px_rgba(11,110,53,0.55)] ${compact ? "" : ""}`}>
          <Image src="/mpesa-qr.png" alt="M-Pesa scan-to-pay QR" width={176} height={176} className={compact ? "h-32 w-32" : "h-40 w-40 sm:h-44 sm:w-44"} />
        </div>
        <div className="text-center sm:text-left">
          <p className="font-display text-lg font-bold text-[#0b6e35]">MORGGY TECHNOLOGIES</p>
          <p className="mt-1 text-sm text-dim">Prefer no prompt? Scan with your M-Pesa app and pay directly.</p>
          <div className="mt-2 inline-flex items-center gap-2 rounded-full bg-[#eaf7ec] px-3 py-1 text-sm font-bold text-[#0b6e35]">
            Paybill <span className="font-mono">4567052</span>
          </div>
        </div>
      </div>
      <div className="border-t border-[#3AA335]/20 bg-[#f7fbf8] px-4 py-2.5 text-center text-[11px] font-semibold text-[#3f6b4d]">
        Payments processed over Safaricom M-Pesa · receipt issued for every transaction
      </div>
    </div>
  );
}
