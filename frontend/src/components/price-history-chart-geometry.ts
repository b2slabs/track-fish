/**
 * Pure SVG-geometry helpers for `PriceHistoryChart`'s step-line overlay,
 * split out into their own dependency-free module so they're testable
 * without importing React/Recharts or this project's `@/*` path aliases
 * (neither of which this file needs).
 */

/** Default half-width (px) of a single-point run's line-style stub marker. */
export const SINGLE_POINT_STUB_HALF_WIDTH_PX = 8;

/**
 * Issue #89: a run with exactly one point has nothing to connect it to (it's
 * isolated on both sides by a gap), so there's no "real" line segment to
 * draw — but rendering it as a lone dot made it look categorically different
 * from a multi-point run's connected step-line, misleading a shopper
 * comparing Stores into reading "dot vs. line" as meaningful. This draws a
 * short horizontal stub centered on the point instead, as an SVG path `d`
 * string, so the caller can stroke it with the exact same color/dash/width
 * props a multi-point run's `stepPath` already uses — same visual language,
 * same <path> element, just a fixed small length instead of one driven by a
 * neighboring point.
 */
export function singlePointStubPath(
  cx: number,
  cy: number,
  halfWidth: number = SINGLE_POINT_STUB_HALF_WIDTH_PX,
): string {
  return `M ${cx - halfWidth} ${cy} H ${cx + halfWidth}`;
}
