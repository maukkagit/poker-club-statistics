import type { MetadataRoute } from "next";

/**
 * Web app manifest (served by Next at /manifest.webmanifest and auto-linked
 * from <head>). This is what lets the app be "Add to Home Screen"-ed on
 * Android/Chrome with the club logo as the launcher icon, opening in a
 * standalone window with the app's dark theme.
 *
 * iOS Safari ignores manifest icons for the home-screen shortcut — it uses the
 * apple-touch-icon instead, which Next generates from `app/apple-icon.png`.
 *
 * Icons point at the 1024×1024 square logo in /public. (It's a JPEG saved with
 * a .png name; Next serves it as image/png and browsers decode it fine.)
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Poker Club",
    short_name: "Poker Club",
    description: "Tournament stats",
    start_url: "/",
    display: "standalone",
    background_color: "#0b1020",
    theme_color: "#0b1020",
    icons: [
      { src: "/logo.png", sizes: "1024x1024", type: "image/png", purpose: "any" },
      { src: "/logo.png", sizes: "1024x1024", type: "image/png", purpose: "maskable" },
    ],
  };
}
