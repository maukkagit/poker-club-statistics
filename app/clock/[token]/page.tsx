"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import useSWR from "swr";
import { Fredoka, Rye } from "next/font/google";
import { apiKeys, ApiError } from "@/lib/api";
import { useClockChannel } from "@/components/useClockChannel";
import { useChatChannel } from "@/components/useChatChannel";
import { useClockSounds } from "@/components/useClockSounds";
import TournamentClock from "@/components/TournamentClock";
import TournamentChat from "@/components/TournamentChat";
import { Skeleton } from "@/components/ui/Skeleton";
import type { PublicClock, PublicChat } from "@/lib/types";

/** Western slab-serif used only on the saloon clock skin. */
const saloonFont = Rye({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-saloon",
  display: "swap",
});

/** Playful rounded sans used only on the summer clock skin. */
const summerFont = Fredoka({
  subsets: ["latin"],
  variable: "--font-summer",
  display: "swap",
});

/**
 * Shimmering placeholder shown while the public clock payload loads. Mirrors
 * the scoreboard's three-column shape (live counts · board · prizes) so the
 * layout doesn't jump when the real data arrives.
 */
function ClockSkeleton() {
  return (
    <div className="max-w-7xl mx-auto space-y-3" aria-hidden>
      <Skeleton className="h-16 w-full" />
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,3.2fr)_minmax(0,1fr)] items-start gap-4">
        <div className="flex flex-col gap-5">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
        <Skeleton className="h-72 w-full" />
        <div className="flex flex-col gap-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
        </div>
      </div>
    </div>
  );
}

const SOUND_PREF_KEY = "pcs:clock-sound-on";
const THEME_PREF_KEY = "pcs:clock-theme";

type ClockTheme = "dark" | "light" | "saloon" | "summer";

const CLOCK_THEMES: { id: ClockTheme; label: string; icon: string }[] = [
  { id: "dark", label: "Dark", icon: "🌙" },
  { id: "light", label: "Light", icon: "☀️" },
  { id: "saloon", label: "Saloon", icon: "🤠" },
  { id: "summer", label: "Summer", icon: "🏖️" },
];

function parseClockTheme(raw: string | null): ClockTheme {
  if (raw === "light" || raw === "saloon" || raw === "summer") return raw;
  return "dark";
}

/** Compact theme menu for the public clock (Dark / Light / Saloon / Summer). */
function ClockThemeMenu({
  theme, onChange,
}: {
  theme: ClockTheme;
  onChange: (next: ClockTheme) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = CLOCK_THEMES.find(t => t.id === theme) ?? CLOCK_THEMES[0];

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent | PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Clock theme"
        className="btn btn-secondary !px-3 !py-2 gap-1.5"
      >
        <span aria-hidden className="text-lg leading-none">{current.icon}</span>
        <span className="text-sm font-semibold hidden sm:inline">{current.label}</span>
        <span aria-hidden className="text-xs muted leading-none">▾</span>
        <span className="sr-only">Theme: {current.label}</span>
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label="Clock theme"
          className="absolute right-0 top-full mt-1 z-[70] min-w-[9.5rem] rounded-lg border py-1 shadow-lg"
          style={{
            borderColor: "var(--border)",
            background: "var(--card)",
          }}
        >
          {CLOCK_THEMES.map(opt => {
            const active = opt.id === theme;
            return (
              <li key={opt.id} role="option" aria-selected={active}>
                <button
                  type="button"
                  className={[
                    "w-full flex items-center gap-2 px-3 py-2 text-left text-sm font-semibold",
                    "hover:bg-[color-mix(in_srgb,var(--text)_8%,transparent)]",
                    active ? "text-[var(--accent)]" : "",
                  ].join(" ")}
                  onClick={() => {
                    onChange(opt.id);
                    setOpen(false);
                  }}
                >
                  <span aria-hidden className="text-base leading-none w-5 text-center">{opt.icon}</span>
                  <span className="flex-1">{opt.label}</span>
                  {active && <span aria-hidden className="text-xs">✓</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * Public, read-only projector clock reached via a share token (no login). It
 * polls the public endpoint as a baseline and also subscribes to the realtime
 * channel so director actions (pause/resume/rewind, busts, re-entries) reflect
 * here within a fraction of a second. Rendered as a full-screen overlay so it
 * fills a projector regardless of the surrounding app chrome.
 *
 * Unlike the director console, the viewer link can play sound effects (gong on
 * a new level, buzzer on break start/end, chime in the final minute, a sting on
 * a bustout). Sound is opt-in via the speaker toggle (browsers require a gesture).
 */
export default function PublicClockPage() {
  const { token } = useParams<{ token: string }>();
  const key = token ? apiKeys.publicClock(token) : null;
  const { data, error, isLoading, mutate } = useSWR<PublicClock>(key, {
    refreshInterval: 5000,
  });

  const refetch = useCallback(() => { void mutate(); }, [mutate]);
  useClockChannel(token, refetch);

  // Tournament-director announcements (system chat messages) are surfaced as
  // bottom-of-screen toasts on the full-screen clock, where the chat panel is
  // hidden. Each stays for 10s; up to 2 can overlap so a quick pair both show.
  const { data: chatData, mutate: mutateChat } = useSWR<PublicChat>(
    token ? apiKeys.publicChat(token) : null,
    { refreshInterval: 5000 },
  );
  const refetchChat = useCallback(() => { void mutateChat(); }, [mutateChat]);
  useChatChannel(token, refetchChat);

  const [tdToasts, setTdToasts] = useState<{ id: string; author: string; body: string }[]>([]);
  // Message ids already accounted for. `null` until the first load so existing
  // history doesn't pop as toasts when the page opens.
  const seenIdsRef = useRef<Set<string> | null>(null);
  const toastTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    if (!chatData) return; // wait for the first real payload before tracking
    const msgs = chatData.messages ?? [];
    if (seenIdsRef.current === null) {
      seenIdsRef.current = new Set(msgs.map(m => m.id));
      return;
    }
    const seen = seenIdsRef.current;
    const fresh = msgs.filter(m => m.system && !seen.has(m.id));
    for (const m of msgs) seen.add(m.id);
    if (fresh.length === 0) return;
    setTdToasts(prev => [...prev, ...fresh.map(m => ({ id: m.id, author: m.author_name, body: m.body }))].slice(-2));
    for (const m of fresh) {
      const timer = setTimeout(() => {
        setTdToasts(prev => prev.filter(t => t.id !== m.id));
        toastTimersRef.current.delete(m.id);
      }, 10000);
      toastTimersRef.current.set(m.id, timer);
    }
  }, [chatData]);

  useEffect(() => {
    const timers = toastTimersRef.current;
    return () => { timers.forEach(t => clearTimeout(t)); };
  }, []);

  // Sound is ON by default; a stored preference (from the toggle) overrides it.
  const [soundOn, setSoundOn] = useState(true);
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(SOUND_PREF_KEY);
      setSoundOn(stored == null ? true : stored === "1");
    } catch { /* ignore */ }
  }, []);

  // Theme: dark (default), light, saloon, or summer. Persisted per device.
  const [theme, setTheme] = useState<ClockTheme>("dark");
  useEffect(() => {
    try {
      setTheme(parseClockTheme(window.localStorage.getItem(THEME_PREF_KEY)));
    } catch { /* ignore */ }
  }, []);

  const chooseTheme = useCallback((next: ClockTheme) => {
    setTheme(next);
    try { window.localStorage.setItem(THEME_PREF_KEY, next); } catch { /* ignore */ }
  }, []);

  // The director can disable sounds (or just the knockout sting) for everyone
  // from the live manager; the viewer's own toggle gates on top of that.
  const directorSound = data?.soundEnabled !== false;
  const { unlock } = useClockSounds({
    enabled: soundOn && directorSound,
    knockoutsEnabled: data?.soundKnockouts !== false,
    structure: data?.structure ?? [],
    clock: data?.clock ?? null,
    // Total buy-ins minus survivors = bustouts so far. This rises on every
    // elimination and is unaffected by a re-entry (which bumps buy-ins too), so
    // the sting still plays when a player busts and immediately re-enters.
    bustouts: Math.max(
      0,
      (data?.aggregates.totalBuyIns ?? 0) - (data?.aggregates.playersRemaining ?? 0),
    ),
  });

  // Audio can't start until a user gesture. Since sound is on by default, unlock
  // the audio engine on ANY interaction anywhere on the page, so the viewer
  // doesn't have to find and toggle the speaker button first. We deliberately
  // don't use `{ once: true }`: re-running unlock on every gesture is cheap
  // (resume + override decode are idempotent) and also re-resumes a context the
  // browser suspended after a tab switch or entering full-screen — the exact
  // situations where sound previously went silent until a manual toggle. A
  // visibility change re-arms it too (it doesn't unlock by itself, but the next
  // tap will). `unlock` is stable, so these listeners attach once per enable.
  useEffect(() => {
    if (!(soundOn && directorSound)) return;
    const onGesture = () => unlock();
    const opts = { passive: true } as const;
    window.addEventListener("pointerdown", onGesture, opts);
    window.addEventListener("keydown", onGesture, opts);
    window.addEventListener("touchstart", onGesture, opts);
    const onVisible = () => { if (document.visibilityState === "visible") unlock(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
      window.removeEventListener("touchstart", onGesture);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [soundOn, directorSound, unlock]);

  const toggleSound = useCallback(() => {
    setSoundOn(prev => {
      const next = !prev;
      if (next) unlock();
      try { window.localStorage.setItem(SOUND_PREF_KEY, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  }, [unlock]);

  // Full-screen mode requests the Fullscreen API on the clock wrapper, which
  // hides the browser chrome (URL bar etc.) and — because the chat lives
  // outside the wrapper — shows only the header bars and the clock. On Android
  // we also try to lock the orientation to landscape.
  //
  // iOS Safari supports neither the Fullscreen API on non-video elements nor
  // orientation lock, so there we fall back to a "pseudo" full-screen: a fixed
  // overlay that, when the phone is in portrait, rotates the clock 90° to make
  // it landscape and fill the screen.
  const clockRef = useRef<HTMLDivElement>(null);
  const [realFs, setRealFs] = useState(false);
  const [pseudoFs, setPseudoFs] = useState(false);
  const [portrait, setPortrait] = useState(false);
  const isFullscreen = realFs || pseudoFs;

  useEffect(() => {
    const onChange = () => setRealFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(orientation: portrait)");
    const onChange = () => setPortrait(mq.matches);
    onChange();
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  // Auto-hide controls after inactivity in fullscreen. Any pointer movement or
  // touch resets the timer and immediately reveals the buttons again.
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFullscreenRef = useRef(false);
  isFullscreenRef.current = isFullscreen;

  const bumpVisibility = useCallback(() => {
    setControlsVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    if (isFullscreenRef.current) {
      hideTimerRef.current = setTimeout(() => setControlsVisible(false), 3500);
    }
  }, []);

  // When entering fullscreen kick off the first hide timer; when leaving,
  // cancel any pending timer and keep the controls visible.
  useEffect(() => {
    if (isFullscreen) {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      hideTimerRef.current = setTimeout(() => setControlsVisible(false), 3500);
    } else {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      setControlsVisible(true);
    }
    return () => { if (hideTimerRef.current) clearTimeout(hideTimerRef.current); };
  }, [isFullscreen]);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement || pseudoFs) {
      if (document.fullscreenElement) void document.exitFullscreen?.();
      try { (screen.orientation as { unlock?: () => void } | undefined)?.unlock?.(); } catch { /* ignore */ }
      setPseudoFs(false);
      return;
    }
    const el = clockRef.current;
    if (el && typeof el.requestFullscreen === "function") {
      el.requestFullscreen().then(() => {
        // Best-effort landscape lock (supported on Android Chrome, ignored elsewhere).
        try {
          (screen.orientation as { lock?: (o: string) => Promise<void> } | undefined)
            ?.lock?.("landscape").catch(() => {});
        } catch { /* ignore */ }
      }).catch(() => setPseudoFs(true));
    } else {
      // iOS Safari: no element fullscreen — use the rotated overlay fallback.
      setPseudoFs(true);
    }
  }, [pseudoFs]);

  const controls = (
    <div
      className={
        isFullscreen
          ? // Projector/full-screen: float over the top-right corner and
            // auto-hide after inactivity so nothing permanently obscures the
            // board.
            "fixed top-3 right-3 z-[60] flex gap-2 transition-opacity duration-500"
          : // Normal viewing: a static, right-aligned toolbar that sits above
            // the clock instead of hovering over the header card / chat panel.
            "flex justify-end gap-2 mb-2 sm:mb-3"
      }
      style={
        isFullscreen
          ? {
              opacity: controlsVisible ? 1 : 0,
              pointerEvents: controlsVisible ? "auto" : "none",
            }
          : undefined
      }
    >
      <ClockThemeMenu theme={theme} onChange={chooseTheme} />
      <button
        type="button"
        onClick={toggleSound}
        aria-pressed={soundOn && directorSound}
        disabled={!directorSound}
        title={!directorSound
          ? "Sound effects are turned off by the tournament director"
          : soundOn ? "Mute clock sound effects" : "Enable clock sound effects"}
        className="btn btn-secondary !px-3 !py-2 disabled:opacity-50"
      >
        <span aria-hidden className="text-lg leading-none">{soundOn && directorSound ? "🔊" : "🔇"}</span>
        <span className="sr-only">{soundOn && directorSound ? "Sound on" : "Sound off"}</span>
      </button>
      <button
        type="button"
        onClick={toggleFullscreen}
        aria-pressed={isFullscreen}
        title={isFullscreen ? "Exit full-screen mode" : "Full-screen mode"}
        className="btn btn-secondary !px-3 !py-2"
      >
        <svg aria-hidden width="20" height="20" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {isFullscreen ? (
            <>
              <path d="M9 3v4a2 2 0 0 1-2 2H3" />
              <path d="M15 3v4a2 2 0 0 0 2 2h4" />
              <path d="M9 21v-4a2 2 0 0 0-2-2H3" />
              <path d="M15 21v-4a2 2 0 0 1 2-2h4" />
            </>
          ) : (
            <>
              <path d="M3 9V5a2 2 0 0 1 2-2h4" />
              <path d="M21 9V5a2 2 0 0 0-2-2h-4" />
              <path d="M3 15v4a2 2 0 0 0 2 2h4" />
              <path d="M21 15v4a2 2 0 0 1-2 2h-4" />
            </>
          )}
        </svg>
        <span className="sr-only">{isFullscreen ? "Exit full-screen" : "Full-screen mode"}</span>
      </button>
    </div>
  );

  return (
    <div
      className={`fixed inset-0 z-50 overflow-auto p-2 sm:p-3 ${saloonFont.variable} ${summerFont.variable}`}
      data-theme={theme}
      style={{
        // Use backgroundColor (not `background`) so theme layers like the
        // saloon wood planks / summer beach stripes from CSS can show through.
        backgroundColor: "var(--bg)",
        cursor: isFullscreen && !controlsVisible ? "none" : undefined,
      }}
      onPointerMove={bumpVisibility}
      onPointerDown={bumpVisibility}
    >
      {error ? (
        <div className="card neg max-w-md mx-auto mt-20 text-center">
          {error instanceof ApiError && error.status === 404
            ? "This clock link is invalid or the tournament was removed."
            : "Couldn't load the tournament clock."}
        </div>
      ) : isLoading || !data ? (
        <ClockSkeleton />
      ) : (
        <div className="max-w-7xl mx-auto">
          {/* Normal viewing: the controls are a page-level top-right toolbar
              above both columns, so the clock and chat start at the same y. */}
          {!isFullscreen && controls}
          <div className="space-y-4 lg:space-y-0 lg:flex lg:items-stretch lg:gap-4">
          <div
            ref={clockRef}
            className={
              isFullscreen
                ? `relative flex flex-col p-4 sm:p-8${
                    theme === "saloon"
                      ? " saloon-wood-bg"
                      : theme === "summer"
                        ? " summer-beach-bg"
                        : ""
                  }`
                : "lg:flex-1 lg:min-w-0"
            }
            style={
              pseudoFs
                ? {
                    // Art themes keep their striped letterbox via CSS classes.
                    // Other themes use a solid fill.
                    ...(theme === "saloon" || theme === "summer"
                      ? {}
                      : { background: "var(--bg)" }),
                    position: "fixed",
                    zIndex: 55,
                    transformOrigin: "top left",
                    // Portrait phones get rotated 90° into landscape so the
                    // clock uses the full screen; landscape just fills it.
                    ...(portrait
                      ? {
                          top: 0,
                          left: 0,
                          width: "100dvh",
                          height: "100dvw",
                          transform: "translateX(100dvw) rotate(90deg)",
                        }
                      : { inset: 0 }),
                  }
                : realFs
                  ? theme === "saloon" || theme === "summer"
                    ? undefined
                    : { background: "var(--bg)" }
                  : undefined
            }
          >
            {isFullscreen && controls}
            {/* Normally centered + width-capped. In full-screen the container
                flexes to fill the whole screen and the clock scales up to fill
                it (both width and height). */}
            <div className={isFullscreen ? "flex-1 min-h-0 w-full flex flex-col" : "space-y-4"}>
              <TournamentClock
                title={data.title}
                subtitle={data.subtitle}
                structure={data.structure}
                clock={data.clock}
                aggregates={data.aggregates}
                payouts={data.payouts}
                addonsAllowed={data.addonsAllowed}
                bounty={data.bounty ?? null}
                prizePoolDisplay={data.prizePoolTotal ?? null}
                payoutsLabel={data.isPko ? "Payouts (excl. bounties)" : undefined}
                fillViewport={isFullscreen}
                hideHeading
                hideLiveStatus
                animatedTitle={data.titleGradient !== false}
                skin={theme === "saloon" || theme === "summer" ? theme : "default"}
              />
            </div>
            {isFullscreen && tdToasts.length > 0 && (
              <div className="absolute inset-x-0 bottom-0 z-[70] flex flex-col items-center gap-2 p-4 sm:p-6 pointer-events-none">
                {tdToasts.map(t => (
                  <div
                    key={t.id}
                    className="td-toast pointer-events-auto w-full max-w-5xl rounded-xl px-6 py-3 text-center shadow-2xl"
                    style={{
                      background: "color-mix(in srgb, var(--accent) 22%, var(--card))",
                      border: "1px solid color-mix(in srgb, var(--accent) 60%, transparent)",
                    }}
                  >
                    <div className="text-[0.65rem] uppercase tracking-widest font-bold" style={{ color: "var(--accent)" }}>
                      {t.author}
                    </div>
                    <div className="text-xl sm:text-2xl font-semibold break-words leading-snug">{t.body}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
          {/* Keep the chat mounted (just hidden) in full-screen so returning to
              the normal view doesn't remount it and auto-focus its input. */}
          {token && (
            <div className={isFullscreen ? "hidden" : "lg:w-96 lg:shrink-0 lg:relative"}>
              <TournamentChat token={token} />
            </div>
          )}
          </div>
        </div>
      )}
    </div>
  );
}
