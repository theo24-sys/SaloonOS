import type { Metadata, Viewport } from "next";
import { Playfair_Display, Jost } from "next/font/google";
import Image from "next/image";
import "./globals.css";
import Link from "next/link";

const playfair = Playfair_Display({ variable: "--font-playfair", subsets: ["latin"] });
const jost = Jost({ variable: "--font-jost", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "SaloonOS — Customer-verified bills",
  description:
    "Every bill must be verified by the customer. Staff bill it, customers verify it, owners see the truth. Manage · Verify · Grow.",
  icons: {
    icon: [
      { url: "/favicon.png", sizes: "64x64", type: "image/png" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: "/icon-192.png",
  },
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#fff9f7",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${playfair.variable} ${jost.variable} antialiased`}>
        <div className="aurora" aria-hidden />
        <header className="no-print sticky top-0 z-10 border-b border-line bg-bg/85 backdrop-blur">
          <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-2.5 sm:px-5 sm:py-3">
            <Link href="/" className="flex shrink-0 items-center gap-2">
              <Image src="/favicon.png" alt="SaloonOS logo" width={40} height={40} className="h-9 w-9 rounded-xl sm:h-10 sm:w-10" />
              <span className="text-lg font-semibold tracking-wide sm:text-xl">
                <span className="font-display">Saloon</span>
                <span className="font-display italic text-brand">OS</span>
              </span>
            </Link>
            <nav className="flex items-center gap-2.5 text-[13px] font-medium text-dim sm:gap-4 sm:text-sm">
              <Link href="/pricing" className="hover:text-ink">Pricing</Link>
              <Link href="/owner" className="hover:text-ink">Owner</Link>
              <Link href="/app" className="hover:text-plum">Staff POS</Link>
              <Link href="/signup" className="rounded-full bg-plum px-3 py-1.5 font-semibold text-white sm:px-4">
                Start free
              </Link>
            </nav>
          </div>
        </header>
        {children}
        <footer className="no-print mx-auto max-w-2xl px-5 py-10 text-center text-xs text-dim space-y-3">
          <Image src="/favicon.png" alt="" width={24} height={24} className="mx-auto h-6 w-6 opacity-70" />
          <div>
            <span className="font-display italic text-ink font-semibold">SaloonOS</span> — Customer-verified billing for salons & barbershops
          </div>
          <div className="text-[11px] text-dim/80">
            A product of <span className="font-semibold text-ink">Morggy Technologies</span> · Juja, Nairobi · Tel: <a href="tel:0714042946" className="text-plum font-semibold hover:underline">0714042946</a>
          </div>
          <div className="flex items-center justify-center gap-4 text-[11px]">
            <Link href="/pricing" className="hover:text-ink">Pricing</Link>
            <span>·</span>
            <Link href="/privacy" className="hover:text-ink">Privacy Policy</Link>
            <span>·</span>
            <Link href="/terms" className="hover:text-ink">Terms of Service</Link>
          </div>
          <div className="text-[10px] text-dim/60 pt-2 border-t border-line">
            © 2026 Morggy Technologies. All rights reserved.
          </div>
        </footer>
      </body>
    </html>
  );
}
