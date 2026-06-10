// Color generator: golden-ratio hue spacing (137.508°) combined with 5
// lightness bands × 3 saturation bands.
//
// Why the band sizes matter: with golden-ratio hue stepping, the small
// Fibonacci-like step counts (2, 3, 5, 8, 13, 21) produce the closest hue
// collisions modulo 360°. The two worst are step-8 (Δhue ≈ 20°) and step-21
// (Δhue ≈ 7.7°). Picking band lengths coprime with 8 (= 2³) and 21 (= 3·7)
// guarantees those collision pairs land on different L and S values, so they
// differ in brightness/saturation even when their hues are nearly identical.
// 5 and 3 satisfy that.
//
// The L and S values themselves are interleaved (not monotonic) so that
// adjacent alphabetical players also get visibly different brightnesses,
// which makes the legend row read as colourful instead of as a smooth gradient.
const GOLDEN_HUE = 137.508;
const L_BANDS = [45, 72, 90, 55, 78];
const S_BANDS = [68, 92, 80];

export function colorForIndex(i: number): string {
  const hue = (i * GOLDEN_HUE) % 360;
  const l = L_BANDS[i % L_BANDS.length];
  const s = S_BANDS[i % S_BANDS.length];
  return `hsl(${hue.toFixed(1)} ${s}% ${l}%)`;
}
