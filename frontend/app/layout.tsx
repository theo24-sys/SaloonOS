import type { Metadata, Viewport } from "next";
import { Playfair_Display, Jost } from "next/font/google";
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
              <img src="/favicon.png" alt="SaloonOS logo" className="h-9 w-9 rounded-xl sm:h-10 sm:w-10" />
              <span className="text-lg font-semibold tracking-wide sm:text-xl">
                <span className="font-display">Saloon</span>
                <span className="font-display italic text-brand">OS</span>
              </span>
            </Link>
            <nav className="flex items-center gap-3 text-[13px] font-medium text-dim sm:gap-5 sm:text-sm">
              <Link href="/pricing" className="hover:text-ink">Pricing</Link>
              <Link href="/signup" className="rounded-full bg-plum px-3 py-1.5 font-semibold text-white sm:px-4">
                Start free
              </Link>
              <Link href="/app" className="hover:text-plum">Open app</Link>
            </nav>
          </div>
        </header>
        {children}
        <footer className="no-print mx-auto max-w-2xl px-5 py-10 text-center text-xs text-dim">
          <img src="/favicon.png" alt="" className="mx-auto mb-2 h-6 w-6 opacity-70" />
          <span className="font-display italic">SaloonOS</span> — Manage · Verify · Grow
          <div className="mt-1">Every bill must be verified by the customer <span className="text-brand">♡</span> That&apos;s the product.</div>
        </footer>
      </body>
    </html>
  );
}
