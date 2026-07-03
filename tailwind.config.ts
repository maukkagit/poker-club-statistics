import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // Semantic colours mapped to the CSS custom properties in
      // `globals.css`. Lets JSX use `text-accent` / `border-border` / etc.
      // instead of hard-coding hex, and they follow the scoped light theme
      // (clock viewer) for free.
      colors: {
        bg: "var(--bg)",
        card: "var(--card)",
        accent: "var(--accent)",
        danger: "var(--danger)",
        border: "var(--border)",
        muted: "var(--muted)",
        text: "var(--text)",
      },
      backgroundImage: {
        // The shared raised-card gradient — `bg-surface` replaces the
        // duplicated `bg-gradient-to-b from-[#1a224a] to-[#0e1430]`.
        surface: "linear-gradient(to bottom, var(--surface-from), var(--surface-to))",
      },
      borderRadius: {
        card: "12px",
        btn: "8px",
      },
      boxShadow: {
        // Raised-tile inner highlight + a hover elevation, matching the
        // hand-rolled values previously inlined on MetricTile / .card.
        tile: "inset 0 1px 0 rgba(255,255,255,0.04)",
        "tile-hover":
          "inset 0 1px 0 rgba(255,255,255,0.06), 0 2px 8px rgba(0,0,0,0.35)",
        lift: "0 10px 30px rgba(0,0,0,.35)",
      },
      transitionTimingFunction: {
        // Shared easing tokens — mirror the CSS custom properties in
        // `globals.css` so Tailwind utilities and hand-rolled CSS animate
        // with an identical feel.
        emphasized: "cubic-bezier(0.2, 0, 0, 1)",
        spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
      },
      keyframes: {
        "pop-in": {
          "0%": { opacity: "0", transform: "scale(0.6)" },
          "60%": { opacity: "1", transform: "scale(1.12)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
      },
      animation: {
        "pop-in": "pop-in 260ms cubic-bezier(0.34, 1.56, 0.64, 1)",
      },
    },
  },
  plugins: [animate],
} satisfies Config;
