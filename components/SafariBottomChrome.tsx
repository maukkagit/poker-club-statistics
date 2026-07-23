"use client";

import { usePathname } from "next/navigation";

/**
 * iOS Safari 26+ tints the bottom toolbar from whatever is visually at the
 * bottom edge (fixed/sticky first, else in-flow content / `body`). After a
 * client navigation the dashboard cards sit under the toolbar, so Safari
 * samples those dark surfaces and paints a solid black bar.
 *
 * A high-z, background-less fixed stripe at the bottom wins the sample instead
 * (same trick as https://gist.github.com/kentbrew/74bd4319034aa4c025039f48488a7a89).
 * Remount on route change so Safari re-evaluates after soft navigations.
 * Invisible: no fill, no blur, pointer-events none; z-index stays below modals.
 */
export default function SafariBottomChrome() {
  const pathname = usePathname();
  return <div key={pathname} className="safari-bottom-chrome" aria-hidden />;
}
