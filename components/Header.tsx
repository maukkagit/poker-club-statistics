"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import NewTournamentChooser from "@/components/NewTournamentChooser";
import type { TournamentState } from "@/lib/types";

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/tournaments", label: "Tournaments" },
  { href: "/players", label: "Players" },
  { href: "/locations", label: "Locations" },
];

export default function Header() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  // Chooser modal that asks "starting now" vs "already finished" before
  // routing into the right form variant. Owned by the Header so the "+ New
  // tournament" button is reachable from every route — the per-page button
  // on /tournaments has been removed to avoid two competing entry points.
  const [chooserOpen, setChooserOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  // Portal target only exists after first client render.
  useEffect(() => {
    setMounted(true);
  }, []);

  // Auto-close the drawer whenever the route changes (i.e. user tapped a link).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  function openChooser() {
    // Close the mobile drawer first so the chooser modal isn't visually
    // stacked under it; on desktop the drawer is never open so this is a
    // no-op there.
    setOpen(false);
    setChooserOpen(true);
  }
  function pickState(state: TournamentState) {
    setChooserOpen(false);
    router.push(`/tournaments/new?state=${state}`);
  }

  // Lock body scroll while the drawer is open so the page underneath doesn't
  // move when the user scrolls inside the menu on touch devices.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <header className="border-b border-[var(--border)] sticky top-0 bg-[var(--bg)]/90 backdrop-blur z-20">
      <nav className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-4">
        <Link href="/" className="font-bold text-lg shrink-0">♠ Poker Club</Link>

        {/* Desktop / tablet nav — visible from md (768px) and up */}
        <div className="hidden md:flex items-center gap-4">
          {NAV.map(item => (
            <Link key={item.href} href={item.href} className="link">{item.label}</Link>
          ))}
        </div>
        <div className="hidden md:flex ml-auto">
          <button type="button" onClick={openChooser} className="btn">+ New tournament</button>
        </div>

        {/* Mobile-only action cluster: a quick-access green "+" that opens
            the chooser directly (so the most common task is one tap away),
            sitting immediately to the left of the hamburger menu. The
            wrapper carries `ml-auto` so the whole group floats to the
            right of the logo on small screens. */}
        <div className="ml-auto md:hidden flex items-center gap-2">
          <button
            type="button"
            aria-label="Add tournament"
            onClick={openChooser}
            className="inline-flex items-center justify-center w-10 h-10 rounded-md text-white shadow-sm transition-colors"
            style={{ background: "rgb(16 185 129)" }}
            onMouseDown={e => (e.currentTarget.style.background = "rgb(5 150 105)")}
            onMouseUp={e => (e.currentTarget.style.background = "rgb(16 185 129)")}
            onMouseLeave={e => (e.currentTarget.style.background = "rgb(16 185 129)")}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>

          <button
            type="button"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen(v => !v)}
            className="inline-flex items-center justify-center w-10 h-10 rounded border border-[var(--border)] text-[var(--text)]"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {open ? (
                <>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </>
              ) : (
                <>
                  <line x1="3" y1="7" x2="21" y2="7" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="17" x2="21" y2="17" />
                </>
              )}
            </svg>
          </button>
        </div>
      </nav>

      {/* Mobile slide-in drawer + backdrop. Rendered via a portal to <body>
          because the <header> uses `backdrop-blur`, which creates a containing
          block for any `position: fixed` descendant — without the portal, the
          drawer would be clipped to the header's height. */}
      {mounted && createPortal(
        <div
          className={`md:hidden fixed inset-0 z-50 transition-opacity duration-200 ${open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
          aria-hidden={!open}
        >
          <div
            className="absolute inset-0"
            style={{ background: "rgba(0,0,0,0.6)" }}
            onClick={() => setOpen(false)}
          />
          <aside
            className={`absolute top-0 right-0 h-full w-72 max-w-[80vw] shadow-2xl transition-transform duration-200 ${open ? "translate-x-0" : "translate-x-full"}`}
            style={{ background: "var(--card)", borderLeft: "1px solid var(--border)" }}
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
          >
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
            <span className="font-bold text-lg">♠ Poker Club</span>
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => setOpen(false)}
              className="inline-flex items-center justify-center w-9 h-9 rounded border border-[var(--border)] text-[var(--text)]"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <ul className="p-2">
            {NAV.map(item => {
              const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={`block px-3 py-3 rounded text-base ${active ? "bg-[var(--bg)] text-[var(--accent)] font-semibold" : "text-[var(--text)]"}`}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="p-3 border-t border-[var(--border)]">
            <button
              type="button"
              onClick={openChooser}
              className="btn w-full justify-center"
            >
              + New tournament
            </button>
          </div>
        </aside>
      </div>,
      document.body
      )}

      <NewTournamentChooser
        open={chooserOpen}
        onChoose={pickState}
        onCancel={() => setChooserOpen(false)}
      />
    </header>
  );
}
