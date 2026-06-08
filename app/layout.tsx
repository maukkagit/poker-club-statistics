import "./globals.css";
import type { ReactNode } from "react";
import Header from "@/components/Header";
import SwrProvider from "@/components/SwrProvider";

export const metadata = { title: "Poker Club", description: "Tournament stats" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SwrProvider>
          <Header />
          <main className="max-w-6xl mx-auto px-4 py-6">{children}</main>
        </SwrProvider>
      </body>
    </html>
  );
}
