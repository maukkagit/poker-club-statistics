/**
 * iOS Safari 26+ tints the browser chrome from nearby sticky/fixed backgrounds
 * (and falls back to `body`). Our sticky header intentionally keeps the top
 * chrome opaque navy; without a bottom sample, Safari paints the bottom
 * toolbar solid black from `body`'s dark `--bg`.
 *
 * This fixed, near-transparent bottom hitch is what Safari samples for the
 * bottom edge, so the toolbar stays Liquid Glass after client navigations.
 * Invisible to users (`pointer-events: none`, 1px tall).
 */
export default function SafariBottomChrome() {
  return <div className="safari-bottom-chrome" aria-hidden />;
}
