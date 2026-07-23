import { cn } from "@/components/ui/cn";

/** Pulsing green dot used to signal live / in-progress state. */
export function LiveDot({ className }: { className?: string } = {}) {
  return (
    <span className={cn("relative inline-flex h-2.5 w-2.5 shrink-0", className)} aria-hidden="true">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
    </span>
  );
}
