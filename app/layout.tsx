import "./globals.css";
import type { ReactNode } from "react";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import Header from "@/components/Header";
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
  // Tint the OS status bar / task-switcher entry with the app's dark navy
  // ONLY when running as an installed home-screen app (standalone) — Safari
  // 15–18.6 and some Chromium builds otherwise apply this meta tag to a
  // regular browser tab's toolbar too, and a normal visit shouldn't get our
  // dark theme bled into the browser's own chrome. `media` renders as the
  // <meta name="theme-color" media="..."> attribute, so browsers simply
  // don't apply it outside of standalone display mode.
  //
  // Safari 26 currently ignores the theme-color meta tag altogether and
  // instead derives its toolbar tint straight from page CSS (the sticky
  // header's background-color, falling back to <body>) — a known WebKit
  // behavior with no supported opt-out yet. See the sticky header in
  // components/Header.tsx for the other half of this fix (a solid, not
  // semi-transparent, background so that sampling is at least deterministic).
  themeColor: [{ media: "(display-mode: standalone)", color: "#0b1020" }],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="antialiased">
        <SwrProvider>
          <Header />
          <main className="max-w-6xl mx-auto px-4 py-6">{children}</main>
        </SwrProvider>
      </body>
    </html>
  );
}
