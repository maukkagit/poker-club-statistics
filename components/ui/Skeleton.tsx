import { cn } from "./cn";

/**
 * Shimmering placeholder block for loading states. Compose several to sketch
 * the shape of the content that's about to arrive (a title bar, a few rows).
 * The shimmer animation lives in globals.css (`.skeleton`).
 *
 *   <Skeleton className="h-6 w-40" />
 */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("skeleton", className)} />;
}
