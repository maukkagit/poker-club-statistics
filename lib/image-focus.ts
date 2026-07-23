/**
 * Helpers for the tournament photo focal point (image_focus_x / image_focus_y).
 *
 * Values are percentages of the natural image (0 = left/top, 100 = right/bottom).
 * Null / missing means geometric center — matching CSS `object-position` default.
 */

export type ImageFocus = { x: number; y: number };

export const DEFAULT_IMAGE_FOCUS: ImageFocus = { x: 50, y: 50 };

export function clampFocus(n: number): number {
  if (!Number.isFinite(n)) return 50;
  return Math.min(100, Math.max(0, n));
}

export function normalizeFocus(x?: number | null, y?: number | null): ImageFocus {
  return {
    x: clampFocus(x ?? DEFAULT_IMAGE_FOCUS.x),
    y: clampFocus(y ?? DEFAULT_IMAGE_FOCUS.y),
  };
}

/** CSS `object-position` value for an `<img className="object-cover">`. */
export function imageObjectPosition(x?: number | null, y?: number | null): string {
  const f = normalizeFocus(x, y);
  return `${f.x}% ${f.y}%`;
}
