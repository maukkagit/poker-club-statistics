import "./globals.css";
import type { ReactNode } from "react";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import Header from "@/components/Header";
import SafariBottomChrome from "@/components/SafariBottomChrome";
import SwrProvider from "@/components/SwrProvider";

export const metadata = {
  title: "Poker Club",
  description: "Tournament stats",
  applicationName: "Poker Club",
  // iOS "Add to Home Screen" title + status bar. The home-screen icon itself
  // comes from app/apple-icon.png. We intentionally omit `capable` here: it
  // emits the deprecated <meta name="apple-mobile-web-app-capable"> tag that
  // Chrome warns about. Standalone launch is declared the modern way via the
  // web app manifest (app/manifest.ts → `display: "standalone"`).
  appleWebApp: { title: "Poker Club", statusBarStyle: "default" as const },
};

// Pin the scale so iOS Safari doesn't auto-zoom when focusing a sub-16px input.
// This keeps the input font sizes as-is (no visual bump) at the cost of
// disabling pinch-zoom on the page.
export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  // Needed so iOS Safari can tint the bottom toolbar from page content
  // (and so safe-area env vars are reliable in standalone mode).
  viewportFit: "cover" as const,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="antialiased">
        <SwrProvider>
          <Header />
          <main className="max-w-6xl mx-auto px-4 py-6">{children}</main>
          <SafariBottomChrome />
        </SwrProvider>
      </body>
    </html>
  );
}
