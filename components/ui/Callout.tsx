import type { ReactNode } from "react";

export type CalloutVariant = "info" | "warning" | "danger" | "success";

/** Accent color per variant — tints (border/background) are derived from it. */
const ACCENT: Record<CalloutVariant, string> = {
  info: "var(--accent)",
  warning: "rgb(251 191 36)",
  danger: "var(--danger)",
  success: "var(--accent)",
};

function VariantIcon({ variant }: { variant: CalloutVariant }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (variant) {
    case "warning":
      return (
        <svg {...common}>
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      );
    case "danger":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="10" />
          <line x1="15" y1="9" x2="9" y2="15" />
          <line x1="9" y1="9" x2="15" y2="15" />
        </svg>
      );
    case "success":
      return (
        <svg {...common}>
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <path d="M22 4 12 14.01l-3-3" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
      );
  }
}

/**
 * A small, industry-standard callout / alert box: a variant-colored icon and an
 * optional bold title, over a subtly tinted, bordered card. Use for inline
 * warnings, tips and errors so they read consistently across the app.
 */
export function Callout({
  variant = "info",
  title,
  children,
  className,
}: {
  variant?: CalloutVariant;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const accent = ACCENT[variant];
  return (
    <div
      role="note"
      className={`flex gap-3 rounded-lg border p-3 text-sm leading-snug${className ? ` ${className}` : ""}`}
      style={{
        borderColor: `color-mix(in srgb, ${accent} 40%, transparent)`,
        background: `color-mix(in srgb, ${accent} 10%, transparent)`,
      }}
    >
      <span className="mt-px shrink-0" style={{ color: accent }}>
        <VariantIcon variant={variant} />
      </span>
      <div className="min-w-0">
        {title && (
          <p className="font-semibold mb-0.5" style={{ color: accent }}>{title}</p>
        )}
        {children && <div>{children}</div>}
      </div>
    </div>
  );
}
