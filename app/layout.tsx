import "./globals.css";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata = { title: "Poker Club", description: "Tournament stats" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="border-b border-[var(--border)] sticky top-0 bg-[var(--bg)]/90 backdrop-blur z-10">
          <nav className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-4 flex-wrap">
            <Link href="/" className="font-bold text-lg">♠ Poker Club</Link>
            <Link href="/" className="link">Dashboard</Link>
            <Link href="/tournaments" className="link">Tournaments</Link>
            <Link href="/players" className="link">Players</Link>
            <div className="ml-auto flex gap-2">
              <Link href="/tournaments/new" className="btn">+ New tournament</Link>
            </div>
          </nav>
        </header>
        <main className="max-w-6xl mx-auto px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
