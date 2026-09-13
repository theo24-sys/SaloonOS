import type { Metadata, Viewport } from "next";
import { Playfair_Display, Jost } from "next/font/google";
import "./globals.css";
import AppChrome from "./app-chrome";

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
        <AppChrome>{children}</AppChrome>
      </body>
    </html>
  );
}
