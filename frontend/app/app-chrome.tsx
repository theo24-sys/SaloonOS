"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

export default function AppChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isPrivateApp = pathname === "/app"
    || pathname.startsWith("/v/")
    || pathname.startsWith("/r/")
    || pathname === "/owner"
    || pathname === "/pay"
    || pathname === "/settings"
    || pathname === "/admin-dash";

  if (isPrivateApp) return <>{children}</>;

  return (
    <>
      <header className="no-print sticky top-0 z-10 border-b border-line bg-bg/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-[18px] py-3.5 sm:px-6">
          <Link href="/" className="flex shrink-0 items-center gap-2.5" aria-label="SaloonOS home">
            <Image src="/favicon.png" alt="SaloonOS logo" width={38} height={38} className="h-9 w-9 rounded-[11px]" />
            <span className="text-[19px] font-semibold tracking-wide">
              <span className="font-display">Saloon</span>
              <span className="font-display italic text-brand">OS</span>
            </span>
          </Link>
          <nav className="flex items-center gap-4 text-[13px] font-semibold text-dim sm:gap-7 sm:text-sm">
            <Link href="/pricing" className="transition hover:text-ink">Pricing</Link>
            <Link href="/signup" className="rounded-full bg-plum px-4 py-2 font-bold text-white shadow-[0_8px_18px_-12px_rgba(76,41,72,.8)] transition hover:-translate-y-0.5 hover:bg-[#382039]">
              Start free <span className="ml-1" aria-hidden>↗</span>
            </Link>
          </nav>
        </div>
      </header>
      {children}
      <footer className="no-print mx-auto max-w-6xl px-5 py-12 text-center text-xs text-dim sm:py-16">
        <Image src="/favicon.png" alt="" width={28} height={28} className="mx-auto h-7 w-7 rounded-lg opacity-80" />
        <div className="mt-4">
          <span className="font-display text-base italic font-semibold text-ink">SaloonOS</span> <span className="mx-1 text-line2">·</span> Customer-verified billing for salons &amp; barbershops
        </div>
        <div className="mt-2 text-[11px] text-dim/80">
          A product of <span className="font-semibold text-ink">Morggy Technologies</span> · Juja, Nairobi · Tel: <a href="tel:0714042946" className="text-plum font-semibold hover:underline">0714042946</a>
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[11px]">
          <Link href="/pricing" className="hover:text-ink">Pricing</Link>
          <span>·</span>
          <Link href="/privacy" className="hover:text-ink">Privacy Policy</Link>
          <span>·</span>
          <Link href="/terms" className="hover:text-ink">Terms of Service</Link>
        </div>
        <div className="mx-auto mt-7 max-w-6xl border-t border-line pt-4 text-[10px] text-dim/60">
          © 2026 Morggy Technologies. All rights reserved.
        </div>
      </footer>
    </>
  );
}
