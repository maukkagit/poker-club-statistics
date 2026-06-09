/**
 * Minimal classname combiner — accepts strings, falsy values, and arrays,
 * filters out the falsies, and joins on a space. Same shape as `clsx` /
 * `classnames` but without the dependency.
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
