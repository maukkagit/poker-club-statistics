"use client";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import NewTournamentChooser from "@/components/NewTournamentChooser";
import type { TournamentState } from "@/lib/types";

const NAV = [
  { href: "/", label: "Home" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/tournaments", label: "Tournaments" },
  { href: "/face-off", label: "Face Off" },
  { href: "/players", label: "Players" },
  { href: "/locations", label: "Locations" },
];

export default function Header() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  // Toggled once the page scrolls past the top so the sticky header can grow
  // a hairline shadow — gives the bar a subtle sense of depth over content.
  const [scrolled, setScrolled] = useState(false);
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

  // Single passive scroll listener that flips `scrolled` at a small threshold.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
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
    <header
      className={`border-b sticky top-0 bg-[var(--bg)]/90 backdrop-blur-md z-20 transition-shadow duration-200 ${
        scrolled ? "border-[var(--border)] shadow-[0_6px_20px_-12px_rgba(0,0,0,0.8)]" : "border-transparent"
      }`}
    >
      <nav className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-4">
        <Link href="/" className="group flex items-center gap-2 font-bold text-lg shrink-0">
          <Image
            src="/logo.png"
            alt="Poker Club Stats"
            width={44}
            height={44}
            className="rounded-md transition-transform duration-200 ease-spring group-hover:scale-105 group-active:scale-95"
            priority
          />
          {/* Animated green gradient wordmark (static under reduced motion). */}
          <span className="title-gradient font-extrabold">Poker Club</span>
        </Link>

        {/* Desktop / tablet nav — visible from md (768px) and up. Wider
            gap on `lg:` so the links breathe on roomy desktops without
            crowding the logo on tighter tablet widths. Each link carries an
            animated accent underline: solid for the active route, and a
            softer sweep on hover. */}
        <div className="hidden md:flex items-center gap-5 lg:gap-7">
          {NAV.map(item => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`group relative py-1 text-sm font-medium transition-colors duration-150 ${
                  active ? "text-accent" : "text-[var(--text)] hover:text-accent"
                }`}
              >
                {item.label}
                {active && (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute left-0 -bottom-0.5 h-0.5 w-full rounded-full bg-accent"
                  />
                )}
              </Link>
            );
          })}
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
            className="btn w-10 h-10 justify-center p-0"
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
          drawer would be clipped to the header's height.
          Only mount while open: iOS Safari 26 samples fixed overlays even at
          opacity:0, and the closed drawer's dark backdrop would tint the
          bottom toolbar solid black after using the menu.
          Solid panel wraps menu content only; the lower band (and full-screen
          underlay) uses blur so we don't paint an opaque same-color bar over
          Safari's Liquid Glass region. */}
      {mounted && open && createPortal(
        <div
          className="md:hidden fixed inset-0 z-50"
          aria-hidden={false}
        >
          {/* Full-viewport blur — what shows in the bottom band. */}
          <div
            className="absolute inset-0"
            style={{
              WebkitBackdropFilter: "blur(14px) saturate(1.2)",
              backdropFilter: "blur(14px) saturate(1.2)",
            }}
          />
          {/* Dimmer stops above the toolbar sample band so that zone stays blur-only. */}
          <div
            className="absolute inset-x-0 top-0 bottom-[4.75rem]"
            style={{ background: "rgba(0,0,0,0.55)" }}
            onClick={() => setOpen(false)}
          />
          {/* Invisible hit target for the bottom band (blur-only, no fill). */}
          <div
            className="absolute inset-x-0 bottom-0 h-[4.75rem]"
            onClick={() => setOpen(false)}
          />
          <aside
            className="absolute inset-y-0 right-0 w-72 max-w-[80vw] flex flex-col"
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
          >
            <div
              className="shrink-0 max-h-[calc(100%-4.75rem)] overflow-y-auto shadow-2xl"
              style={{ background: "var(--card)", borderLeft: "1px solid var(--border)" }}
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
                <span className="flex items-center gap-2 font-bold text-lg">
                  <Image src="/logo.png" alt="Poker Club Stats" width={28} height={28} className="rounded-md" />
                  <span>Poker Club</span>
                </span>
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
            </div>
            {/* Drawer column continues full-height; lower band is blur, not solid card. */}
            <div
              className="flex-1 min-h-[4.75rem] border-l border-[var(--border)]/40"
              onClick={() => setOpen(false)}
              aria-hidden
            />
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
