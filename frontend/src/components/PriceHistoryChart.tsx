import { useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, RefObject } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { formatDateTime, formatPrice, normalizeVariantLabel } from '@/lib/format';
import type { HistoryEvent } from '@/types/data';

/**
 * Keepa-style price history chart (issue #59) — replaces the min/max/average
 * range-bar design (issues #35/#42/#47/#53) entirely, not an addition
 * alongside it.
 *
 * Each Store renders as ONE continuous step-line: flat between price
 * changes, stepping at the exact instant a change happened ("stepAfter",
 * the same step shape this file already used for the old single-variant
 * fallback line). The line's value at each observed instant is the
 * **median** price across that Store's currently-available, real-priced
 * variants at that instant — one representative number per Store per
 * timestamp, collapsing multiple variants/Listings the same way the
 * superseded `computeStoreBars` did, just with a different statistic.
 *
 * The signature Keepa behavior this chart is built around: when a Store was
 * out of stock, NO point exists for that instant at all (not a point with
 * `available: false`, not a struck-through variant, not a dot) — so the
 * line genuinely stops and only resumes once the Store is back in stock.
 * That's a deliberate consequence of how `computeStoreInstants` builds each
 * Store's point list, not a separate "hide out of stock" step layered on
 * top (see that function's doc, and issue #59's scope note that this
 * supersedes issue #55's paused toggle — gap-on-out-of-stock is just how
 * this chart always behaves now).
 */

/**
 * Fixed-order categorical palette for per-Store identity (issue #23), reused
 * unchanged here as each Store's step-line color (issue #59 inherits this
 * straight from the superseded range-bar design, issue #35) — one shared,
 * already-validated 8-hue palette, never two independent color schemes
 * layered on the same chart.
 *
 * Hues, order, and hex steps come directly from this project's `dataviz`
 * skill's validated default 8-hue categorical palette (`references/palette.md`
 * in that skill) — assigned in this fixed order, never cycled/re-ranked by
 * price or any other data-dependent rank. Re-validated here with
 * `scripts/validate_palette.js` for both the light and dark chart surfaces
 * (lightness band, chroma floor, CVD separation, normal-vision floor,
 * contrast) before being adopted:
 *
 *   light: all PASS; worst adjacent CVD ΔE 9.1 (target >= 8), worst
 *     normal-vision ΔE 19.6 (floor >= 15); contrast WARN on 3 slots
 *     (aqua/yellow/magenta, < 3:1) — mitigated below by always-visible,
 *     text-token-colored legend/tooltip labels (never the series color
 *     carrying the text), per the skill's "relief channel" rule.
 *   dark: all PASS including contrast (all 8 slots >= 3:1).
 *
 * The CSS custom properties below (defined in `index.css`) carry the
 * light/dark step for each slot; the hex literals here are just the
 * light-mode fallback for environments without custom properties.
 */
const SERIES_COLOR_VARS = [
  'var(--color-series-1, #2a78d6)', // blue
  'var(--color-series-2, #eb6834)', // orange
  'var(--color-series-3, #1baf7a)', // aqua
  'var(--color-series-4, #eda100)', // yellow
  'var(--color-series-5, #e87ba4)', // magenta
  'var(--color-series-6, #008300)', // green
  'var(--color-series-7, #4a3aa7)', // violet
  'var(--color-series-8, #e34948)', // red
];

/**
 * Assigns a slot its color by stable index (first-seen order of a Store
 * across `listings` — never by current price rank), so a Store keeps its
 * color as siblings come and go in the underlying data. Past the 8
 * validated hues (an edge case — not the common case) colors cycle rather
 * than inventing an ungoverned 9th hue; the legend's text label remains the
 * authoritative way to tell those apart.
 */
function seriesColor(index: number): string {
  return SERIES_COLOR_VARS[index % SERIES_COLOR_VARS.length];
}

/**
 * One real-priced, in-stock variant contributing to a `StorePoint` at one
 * instant — carried through to the tooltip so per-variant detail survives
 * collapsing variants into a single median (issue #35's "ideally still
 * lists each individual variant's price" criterion, still true here).
 * Every entry here is, by construction, in stock (see
 * `computeStoreInstants`) — unlike the superseded range-bar design, there's
 * no struck-through/unavailable entry to render, since an unavailable
 * variant never reaches this list at all.
 */
interface VariantPriceDetail {
  id: string;
  label: string;
  price: number;
  available: boolean;
  /**
   * `normalizeVariantLabel`'s `siblingCount` for THIS variant: the size of
   * the variant list its own originating HistoryEvent (one Store, one
   * Listing, one observedAt) actually carried — e.g. `1` for a Store whose
   * Shopify product has exactly one variant, regardless of how many other
   * variants end up pooled alongside it in the same `StorePoint.variants`
   * (see `computeStoreInstants`'s doc on why the pooled list's own length
   * is the wrong number to pass here: issue #56's "Title" tooltip leak).
   */
  siblingCount: number;
}

/**
 * One Store's single representative price at one observed instant (issue
 * #59) — the median of that Store's currently-available, real-priced
 * variants, replacing the min/max/average range bar from issue #35. Trivial
 * for a single-variant Store (the median of one number is that number) and
 * meaningful for several — exactly the same median, just a different input
 * size, per the issue's "identical in kind" acceptance criterion.
 */
interface StorePoint {
  key: string;
  storeSlug: string;
  label: string;
  color: string;
  currency: string;
  timestamp: number;
  observedAt: string;
  median: number;
  /** In-stock, real-priced variants only, ascending by price — the tooltip's breakdown. */
  variants: VariantPriceDetail[];
  /** This Store's stable first-seen index across `listings` — see `seriesColor`. */
  seriesIndex: number;
}

/** Per-Store display identity a point needs: legend/tooltip label, line color, currency. */
interface StoreMeta {
  label: string;
  color: string;
  currency: string;
  seriesIndex: number;
}

/** One (Store, timestamp) instant this Store was actually observed at — see `computeStoreInstants`. */
interface StoreInstant {
  timestamp: number;
  /** The rendered point at this instant, or `null` when the Store had zero currently-available, real-priced variants — i.e. out of stock. */
  point: StorePoint | null;
}

function medianOf(sortedAscending: number[]): number {
  const n = sortedAscending.length;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sortedAscending[mid] : (sortedAscending[mid - 1] + sortedAscending[mid]) / 2;
}

/**
 * Groups every event into (storeSlug, timestamp) instants — the exact same
 * grouping key the superseded `computeStoreBars` used (issue #35) — then
 * classifies each instant as either a renderable `StorePoint` (the median
 * of that instant's currently-available, real-priced variants) or `null`
 * (no variant cleared that bar: the Store was out of stock at this
 * instant).
 *
 * A variant only counts when it is both `available` AND carries a real,
 * nonzero price — `price === 0` is this project's established sold-out
 * placeholder convention (issue #17), unchanged; `available: false` is the
 * ordinary "this exact variant is out of stock" signal most Stores actually
 * use (a nonzero last-known price kept around, per real `data`-branch
 * observations). Either one excludes a variant from the median, and an
 * instant left with none produces `null`, not a point.
 *
 * Returning every instant — including the `null` ones — per Store (not
 * just the renderable points) is what lets `computeStoreLines` tell a
 * genuine "this Store was out of stock here" gap apart from a merely long
 * gap between two otherwise-adjacent observations (see that function's
 * doc): the `null` instants are the former's hard evidence.
 *
 * Each pooled variant keeps its own originating HistoryEvent's variant
 * count as `siblingCount` (see `VariantPriceDetail`), NOT the size of the
 * pooled `group.variants` list being built here. Those two can differ
 * whenever more than one Listing/HistoryEvent lands in the same
 * (storeSlug, timestamp) bucket — e.g. a Store still carrying two separate
 * Shopify Listings for one Canonical Fish (issue #56) that both happened
 * to report at the same instant: each event's own variant array has
 * exactly one entry (Shopify's single-variant "Title" placeholder), but
 * the pooled bucket ends up with two. Using the pooled length as
 * `siblingCount` would make `normalizeVariantLabel` treat each as a
 * "real" multi-variant option (since the pooled count isn't 1) and leave
 * the literal "Title" placeholder unnormalized in the tooltip — the exact
 * leak issue #56 reported. The per-event count is what `normalizeVariantLabel`
 * was always meant to see: "how many variants did Shopify actually give
 * this one product".
 */
function computeStoreInstants(
  events: HistoryEvent[],
  storeMeta: Map<string, StoreMeta>,
): Map<string, StoreInstant[]> {
  const sorted = [...events].sort(
    (a, b) => new Date(a.observedAt).getTime() - new Date(b.observedAt).getTime(),
  );

  interface Group {
    storeSlug: string;
    timestamp: number;
    observedAt: string;
    variants: VariantPriceDetail[];
  }
  const groups = new Map<string, Group>();
  for (const e of sorted) {
    if (!storeMeta.has(e.storeSlug)) continue;
    const timestamp = new Date(e.observedAt).getTime();
    const key = `${e.storeSlug}::${timestamp}`;
    let group = groups.get(key);
    if (!group) {
      group = { storeSlug: e.storeSlug, timestamp, observedAt: e.observedAt, variants: [] };
      groups.set(key, group);
    }
    const eventSiblingCount = (e.variants ?? []).length;
    for (const v of e.variants ?? []) {
      if (v.price === 0 || !v.available) continue; // sold-out placeholder or genuinely out of stock
      group.variants.push({
        id: v.id,
        label: v.label,
        price: v.price,
        available: v.available,
        siblingCount: eventSiblingCount,
      });
    }
  }

  const byStore = new Map<string, StoreInstant[]>();
  for (const group of groups.values()) {
    const meta = storeMeta.get(group.storeSlug)!;
    let point: StorePoint | null = null;
    if (group.variants.length > 0) {
      const sortedVariants = [...group.variants].sort((a, b) => a.price - b.price);
      point = {
        key: `${group.storeSlug}::${group.timestamp}`,
        storeSlug: group.storeSlug,
        label: meta.label,
        color: meta.color,
        currency: meta.currency,
        timestamp: group.timestamp,
        observedAt: group.observedAt,
        median: medianOf(sortedVariants.map((v) => v.price)),
        variants: sortedVariants,
        seriesIndex: meta.seriesIndex,
      };
    }
    const instant: StoreInstant = { timestamp: group.timestamp, point };
    const list = byStore.get(group.storeSlug);
    if (list) list.push(instant);
    else byStore.set(group.storeSlug, [instant]);
  }
  for (const list of byStore.values()) list.sort((a, b) => a.timestamp - b.timestamp);
  return byStore;
}

/**
 * How much larger than a Store's own typical observation gap counts as "too
 * large to bridge" with a connecting line segment (issue #53's heuristic,
 * reused as-is) — a multiple of that Store's own median gap between
 * consecutive rendered points, not a fixed time span, because how often
 * *this* Store is actually observed is the only basis for calling one of
 * its own silent stretches anomalous rather than normal cadence.
 *
 * This only matters for a silent stretch with no hard evidence either way
 * (no event recorded at all, e.g. scraper downtime) — a stretch with an
 * explicit out-of-stock instant in it always breaks the line regardless of
 * how short it was (see `computeStoreLines`).
 */
const GAP_BREAK_MULTIPLIER = 5;

interface StoreLine {
  storeSlug: string;
  color: string;
  runs: StorePoint[][];
}

/**
 * Splits each Store's own instants (already time-sorted by
 * `computeStoreInstants`) into runs that should each be drawn as one
 * connected step-line (issue #59) — breaking the run at a hard boundary
 * (any out-of-stock instant between two points — the genuine Keepa-style
 * gap this chart exists to draw) or a soft one (an unusually large silent
 * gap between two points with no evidence either way, issue #53's
 * heuristic, for stretches this Store simply wasn't observed at all).
 *
 * Deliberately does NOT fall back to the number of points for "is a gap
 * large": a Store observed only twice, ever, with an out-of-stock instant
 * between them, still breaks — hard evidence always wins over "not enough
 * data to call this unusual".
 */
function computeStoreLines(byStoreInstants: Map<string, StoreInstant[]>): StoreLine[] {
  const lines: StoreLine[] = [];
  for (const [storeSlug, instants] of byStoreInstants) {
    const points = instants.filter((i): i is StoreInstant & { point: StorePoint } => i.point !== null);
    if (points.length === 0) {
      lines.push({ storeSlug, color: '', runs: [] });
      continue;
    }

    const gaps = points.slice(1).map((p, i) => p.point.timestamp - points[i].point.timestamp);
    const sortedGaps = [...gaps].sort((a, b) => a - b);
    const medianGap = sortedGaps.length > 0 ? sortedGaps[Math.floor(sortedGaps.length / 2)] : 0;
    const threshold = medianGap * GAP_BREAK_MULTIPLIER;

    const runs: StorePoint[][] = [[points[0].point]];
    let prevTimestamp = points[0].point.timestamp;
    let sawOutOfStockSincePrevPoint = false;
    for (const instant of instants) {
      if (instant.timestamp <= prevTimestamp) continue;
      if (instant.point) {
        const gap = instant.timestamp - prevTimestamp;
        const shouldBreak = sawOutOfStockSincePrevPoint || (medianGap > 0 && gap > threshold);
        if (shouldBreak) runs.push([instant.point]);
        else runs[runs.length - 1].push(instant.point);
        prevTimestamp = instant.timestamp;
        sawOutOfStockSincePrevPoint = false;
      } else {
        sawOutOfStockSincePrevPoint = true;
      }
    }
    lines.push({ storeSlug, color: points[0].point.color, runs });
  }
  return lines;
}

interface Domain {
  minT: number;
  maxT: number;
  minP: number;
  maxP: number;
}

/** Shared time+price domain every point is plotted against, padded like Recharts' own 'auto' Y domain. */
function useLineDomain(lines: StoreLine[]): Domain | null {
  return useMemo(() => {
    let minT = Infinity;
    let maxT = -Infinity;
    let minP = Infinity;
    let maxP = -Infinity;
    let any = false;
    for (const line of lines) {
      for (const run of line.runs) {
        for (const p of run) {
          any = true;
          if (p.timestamp < minT) minT = p.timestamp;
          if (p.timestamp > maxT) maxT = p.timestamp;
          if (p.median < minP) minP = p.median;
          if (p.median > maxP) maxP = p.median;
        }
      }
    }
    if (!any) return null;
    const pad = (maxP - minP) * 0.1 || Math.max(maxP, 1) * 0.1;
    return {
      minT,
      maxT: maxT === minT ? maxT + 1 : maxT,
      minP: Math.max(0, minP - pad),
      maxP: maxP + pad,
    };
  }, [lines]);
}

interface PlotRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Measures the chart's actual plotting-area rectangle (relative to the
 * hover container) straight from Recharts' own
 * `.recharts-cartesian-grid-bg` background rect via the DOM — the technique
 * issue #29 introduced for hover and issue #35 reused for its range-bar
 * overlay, kept as-is here since a step-line overlay needs exactly the same
 * pixel-aligned plotting rectangle to stay aligned with the axes as the
 * container resizes (tracked here via `ResizeObserver`, since points must
 * be visible on first paint, not only after a mouse move).
 *
 * `ResponsiveContainer` measures its own box and only mounts the actual
 * chart (and so `.recharts-cartesian-grid-bg`) on a follow-up render after
 * that — a real, observed race: on a cold load this effect can run before
 * that element exists yet, and since the *outer* wrapper being observed
 * here doesn't itself resize when that inner content later appears,
 * `ResizeObserver` alone never fires again and the overlay silently never
 * renders. `requestAnimationFrame` polling bridges exactly that gap —
 * cheap, bounded to the handful of frames the element actually takes to
 * appear — and hands off to the `ResizeObserver` once the element is found
 * for ongoing resize tracking.
 */
function usePlotRect(dataLength: number) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<PlotRect | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let rafId: number | null = null;
    let ro: ResizeObserver | null = null;
    let cancelled = false;

    const measure = () => {
      const gridBg = container.querySelector('.recharts-cartesian-grid-bg');
      if (!gridBg) return false;
      const plotBox = gridBg.getBoundingClientRect();
      const containerBox = container.getBoundingClientRect();
      if (plotBox.width === 0 || plotBox.height === 0) return false;
      setRect({
        left: plotBox.left - containerBox.left,
        top: plotBox.top - containerBox.top,
        width: plotBox.width,
        height: plotBox.height,
      });
      return true;
    };

    const pollUntilMounted = () => {
      if (cancelled) return;
      if (measure()) {
        ro = new ResizeObserver(measure);
        ro.observe(container);
        return;
      }
      rafId = requestAnimationFrame(pollUntilMounted);
    };
    pollUntilMounted();

    return () => {
      cancelled = true;
      if (rafId != null) cancelAnimationFrame(rafId);
      ro?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataLength]);

  return { containerRef, rect };
}

/** Maps one point's (timestamp, median) to pixel coordinates inside `rect`. */
function pointXY(rect: PlotRect, domain: Domain, point: StorePoint): { cx: number; cy: number } {
  const cx = rect.left + ((point.timestamp - domain.minT) / (domain.maxT - domain.minT)) * rect.width;
  const cy =
    rect.top + (1 - (point.median - domain.minP) / (domain.maxP - domain.minP)) * rect.height;
  return { cx, cy };
}

/**
 * Builds one run's SVG path in "stepAfter" shape (the same step convention
 * this file already used for the superseded single-variant fallback line):
 * flat at a point's own price until the next point's timestamp, then a
 * vertical jump exactly at that timestamp. `H` (horizontal-to) then `V`
 * (vertical-to) per subsequent point does exactly that, since the path
 * cursor is left at the previous point's y after each `H`.
 */
function stepPath(rect: PlotRect, domain: Domain, run: StorePoint[]): string {
  if (run.length === 0) return '';
  const first = pointXY(rect, domain, run[0]);
  let d = `M ${first.cx} ${first.cy}`;
  for (let i = 1; i < run.length; i++) {
    const { cx, cy } = pointXY(rect, domain, run[i]);
    d += ` H ${cx} V ${cy}`;
  }
  return d;
}

const POINT_RADIUS = 3;
const POINT_RADIUS_HOVERED = 5.5;
const POINT_RING_WIDTH = 1.5;
const LINE_WIDTH = 2;

/**
 * Draws every Store's step-line as an absolutely-positioned SVG overlay on
 * top of Recharts' axes/grid (see `usePlotRect` for why: full control over
 * the per-run step path and the genuine gap between runs, which a native
 * Recharts `<Line>` can't give us here — Stores are observed on
 * independent schedules, so a single shared x-axis dataset would force
 * spurious breaks into a Store's line at every *other* Store's observation
 * time, not just its own). A run of exactly one point (nothing to connect
 * it to, isolated on both sides by a gap) renders as a lone dot instead of
 * a zero-length path.
 */
function StepLinesOverlay({
  lines,
  rect,
  domain,
  hoveredKey,
}: {
  lines: StoreLine[];
  rect: PlotRect;
  domain: Domain;
  hoveredKey?: string;
}) {
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
      {lines.map((line) =>
        line.runs.map((run, runIdx) => {
          if (run.length === 0) return null;
          if (run.length === 1) {
            const { cx, cy } = pointXY(rect, domain, run[0]);
            const isHovered = run[0].key === hoveredKey;
            return (
              <circle
                key={`${line.storeSlug}-${runIdx}`}
                cx={cx}
                cy={cy}
                r={isHovered ? POINT_RADIUS_HOVERED : POINT_RADIUS}
                fill={line.color}
                stroke="var(--color-background, #fff)"
                strokeWidth={POINT_RING_WIDTH}
              />
            );
          }
          return (
            <g key={`${line.storeSlug}-${runIdx}`}>
              <path
                d={stepPath(rect, domain, run)}
                fill="none"
                stroke={line.color}
                strokeWidth={LINE_WIDTH}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {run.map((p) => {
                const { cx, cy } = pointXY(rect, domain, p);
                const isHovered = p.key === hoveredKey;
                return (
                  <circle
                    key={p.key}
                    cx={cx}
                    cy={cy}
                    r={isHovered ? POINT_RADIUS_HOVERED : POINT_RADIUS}
                    fill={line.color}
                    stroke="var(--color-background, #fff)"
                    strokeWidth={POINT_RING_WIDTH}
                  />
                );
              })}
            </g>
          );
        }),
      )}
    </svg>
  );
}

interface PointHoverState {
  point: StorePoint;
  left: number;
  top: number;
}

/**
 * Only surface a tooltip when the cursor is genuinely near a point — beyond
 * this normalized-distance cutoff, hovering empty chart space (including
 * anywhere inside a gap, where there's nothing to snap to) shows nothing
 * rather than always latching onto whatever point happens to be nearest,
 * however far away. Same validated cutoff issues #29/#47/#53 used for the
 * superseded per-variant-line and range-bar hover.
 */
const MAX_HOVER_DIST_SQ = 0.0025;

/**
 * Finds the point genuinely nearest the cursor across every Store's line,
 * normalizing both axes against the plot's own pixel size so time and price
 * contribute comparably (issue #29) — simpler than the range-bar version it
 * replaces (issue #35/#42) since a point has no span to hit-test against,
 * only its own (x, y).
 */
function useNearestPointHover(
  lines: StoreLine[],
  containerRef: RefObject<HTMLDivElement | null>,
  rect: PlotRect | null,
  domain: Domain | null,
) {
  const [hover, setHover] = useState<PointHoverState | null>(null);

  const handleMove = (e: ReactMouseEvent<HTMLDivElement>) => {
    const container = containerRef.current;
    if (!container || !rect || !domain) return;
    const containerBox = container.getBoundingClientRect();
    const mx = e.clientX - containerBox.left;
    const my = e.clientY - containerBox.top;

    let bestPoint: StorePoint | null = null;
    let bestXY: { cx: number; cy: number } | null = null;
    let bestDist = Infinity;
    for (const line of lines) {
      for (const run of line.runs) {
        for (const p of run) {
          const xy = pointXY(rect, domain, p);
          const dx = (xy.cx - mx) / rect.width;
          const dy = (xy.cy - my) / rect.height;
          const dist = dx * dx + dy * dy;
          if (dist < bestDist) {
            bestDist = dist;
            bestPoint = p;
            bestXY = xy;
          }
        }
      }
    }
    if (!bestPoint || !bestXY || bestDist > MAX_HOVER_DIST_SQ) {
      setHover(null);
      return;
    }
    setHover({ point: bestPoint, left: bestXY.cx, top: bestXY.cy });
  };

  return { hover, handleMove, handleLeave: () => setHover(null) };
}

/**
 * Floating tooltip for whatever point `useNearestPointHover` found nearest
 * the cursor: Store, observed date, the median price (the headline value)
 * and — issue #35's "ideally still lists each individual variant's price"
 * criterion, still honored — every variant that went into it. Unlike the
 * superseded range-bar tooltip, nothing here is ever struck through: every
 * variant in `point.variants` is in stock by construction (see
 * `computeStoreInstants`), since an out-of-stock variant never makes it
 * into a point at all. A single-variant point (nothing to take a median of)
 * shows just that one price with no "median" framing and omits the
 * per-variant list, since it would just repeat the same line.
 */
function PointHoverOverlay({ hover }: { hover: PointHoverState }) {
  const { point, left, top } = hover;
  const flipBelow = top < 96;
  const isSingleVariant = point.variants.length <= 1;
  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      <div
        className={`absolute -translate-x-1/2 rounded-md border bg-popover px-3 py-2 text-sm shadow-md ${
          flipBelow ? 'translate-y-3' : '-translate-y-[calc(100%+12px)]'
        }`}
        style={{ left, top, minWidth: '11rem' }}
      >
        <p className="mb-1 flex items-center gap-1.5 font-medium">
          <span
            className="inline-block size-2.5 shrink-0 rounded-[2px]"
            style={{ backgroundColor: point.color }}
          />
          {point.label}
        </p>
        <p className="text-xs text-muted-foreground">{formatDateTime(point.observedAt)}</p>
        {isSingleVariant ? (
          <p className="mt-1 font-medium">{formatPrice(point.median, point.currency)}</p>
        ) : (
          <>
            <p className="mt-1">
              <span className="font-medium">{formatPrice(point.median, point.currency)}</span>{' '}
              <span className="text-xs text-muted-foreground">median</span>
            </p>
            <ul className="mt-1.5 space-y-0.5 border-t pt-1.5 text-xs">
              {point.variants.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">
                    {normalizeVariantLabel(v.label, v.siblingCount)}
                  </span>
                  <span className="font-medium">{formatPrice(v.price, point.currency)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Shared chart chrome for every Keepa-style step-line chart (one Store or
 * many): the Recharts axes/grid for scale and ticks, the step-line overlay
 * drawn on top of them, and the nearest-point hover tooltip. `axisCurrency`
 * formats the Y axis ticks; a Store's own point/tooltip always uses that
 * Store's own currency (see `StorePoint.currency`), never coerced to this
 * axis's.
 */
function StepLineChart({ lines, axisCurrency }: { lines: StoreLine[]; axisCurrency: string }) {
  const domain = useLineDomain(lines);
  const allPoints = useMemo(() => lines.flatMap((l) => l.runs.flat()), [lines]);
  const { containerRef, rect } = usePlotRect(allPoints.length);
  const { hover, handleMove, handleLeave } = useNearestPointHover(lines, containerRef, rect, domain);

  return (
    <div
      ref={containerRef}
      className="relative h-72 w-full"
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={allPoints} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
          {/* `fill="transparent"` (invisible — Recharts' default is `fill="none"`,
              which renders no background rect at all) forces Recharts to render
              its `.recharts-cartesian-grid-bg` rect, which `usePlotRect` reads via
              the DOM to know the plot area's exact pixel bounds. */}
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" fill="transparent" />
          <XAxis
            dataKey="timestamp"
            type="number"
            // Explicit numeric domain (not 'dataMin'/'dataMax') so the axis matches
            // `domain` exactly — the same domain the step-line overlay's own pixel
            // mapping uses — regardless of whether any Recharts graphical child
            // (there are none; lines are a custom overlay) would otherwise
            // contribute to Recharts' own domain auto-detection.
            domain={domain ? [domain.minT, domain.maxT] : ['auto', 'auto']}
            tickFormatter={(ts: number) =>
              new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(ts))
            }
            className="text-xs"
          />
          <YAxis
            tickFormatter={(p: number) => formatPrice(p, axisCurrency)}
            width={80}
            domain={domain ? [domain.minP, domain.maxP] : ['auto', 'auto']}
            className="text-xs"
          />
          {/* Invisible line keyed on each point's median price — points are a custom
              overlay, not a Recharts graphical child, and without any graphical item
              Recharts never generates Y-axis ticks at all (it only ticks an axis
              something is actually plotted against), leaving the Y axis blank even
              though its line/width render. This line's own values are never seen
              (`stroke="none"`, no dot, no active state) — it exists solely to give
              the Y axis a real series to tick against. */}
          <Line
            dataKey="median"
            stroke="none"
            dot={false}
            activeDot={false}
            isAnimationActive={false}
            legendType="none"
          />
        </LineChart>
      </ResponsiveContainer>
      {rect && domain && <StepLinesOverlay lines={lines} rect={rect} domain={domain} hoveredKey={hover?.point.key} />}
      {hover && <PointHoverOverlay hover={hover} />}
    </div>
  );
}

/**
 * One Store's Listing, as the chart needs to know it: which Store it
 * belongs to (for hue), its own currency (a Store's point is always
 * formatted in its own currency, never coerced to another Store's), and its
 * display name for the legend.
 */
export interface ChartListing {
  listingId: string;
  storeSlug: string;
  storeName: string;
  commonName: string;
  currency: string;
}

/**
 * Renders a Canonical Fish's price/availability chart as one Keepa-style
 * step-line per Store (issue #59) — one continuous line per Store, median
 * price at each observed instant, with a genuine gap wherever that Store
 * was out of stock. Handles every case uniformly: a single Listing with a
 * single variant, a single Listing with several variants, and several
 * Listings/Stores together — all the same median-and-gap step-line, just
 * with more or fewer Stores sharing the chart (the issue's "a
 * single-variant Store's line is identical in kind to a multi-variant
 * Store's line" criterion). A legend is only worth showing once there's
 * more than one Store to tell apart; a single Store needs no swatch.
 */
function StoreLinesChart({ events, listings }: { events: HistoryEvent[]; listings: ChartListing[] }) {
  const storeMeta = useMemo(() => {
    const meta = new Map<string, StoreMeta>();
    let idx = 0;
    for (const l of listings) {
      if (meta.has(l.storeSlug)) continue;
      meta.set(l.storeSlug, { label: l.storeName, color: seriesColor(idx), currency: l.currency, seriesIndex: idx });
      idx += 1;
    }
    return meta;
  }, [listings]);
  const lines = useMemo(
    () => computeStoreLines(computeStoreInstants(events, storeMeta)),
    [events, storeMeta],
  );
  const currencies = new Set(listings.map((l) => l.currency));
  // The Y axis is one shared scale across every Store's line; when Stores
  // price in different currencies, format ticks in the first Store's
  // currency as a best-effort axis label and point readers to the tooltip
  // (always formatted per-Store, in that Store's own currency) for the
  // exact figure.
  const axisCurrency = listings[0]?.currency ?? 'USD';
  const showLegend = storeMeta.size > 1;

  return (
    <div className="w-full">
      <StepLineChart lines={lines} axisCurrency={axisCurrency} />
      {showLegend && (
        <div className="mt-2 space-y-1 text-xs text-muted-foreground">
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {Array.from(storeMeta.entries()).map(([storeSlug, meta]) => (
              <span key={storeSlug} className="inline-flex items-center gap-1.5">
                <span
                  className="inline-block size-2.5 shrink-0 rounded-[2px]"
                  style={{ backgroundColor: meta.color }}
                />
                {meta.label}
              </span>
            ))}
          </div>
          {currencies.size > 1 && (
            <p>
              Stores shown price in different currencies — the axis is approximate; hover a point
              for the exact price and currency per Store.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Renders a Canonical Fish's historical price/availability chart from its
 * history events — one Keepa-style step-line per Store carrying it (issue
 * #59), median price at each observed instant, with a genuine gap wherever
 * a Store was out of stock. `listings` must contain exactly the Listings
 * whose events appear in `events` (the Listings a Canonical Fish currently
 * has, from the index).
 */
export function PriceHistoryChart({
  events,
  listings,
}: {
  events: HistoryEvent[];
  listings: ChartListing[];
}) {
  const currency = listings[0]?.currency ?? 'USD';

  if (events.length === 0) {
    return <p className="text-sm text-muted-foreground">No history recorded yet.</p>;
  }

  if (events.length === 1) {
    const only = events[0];
    return (
      <p className="text-sm text-muted-foreground">
        Only one observation recorded so far ({formatDateTime(only.observedAt)}):{' '}
        {formatPrice(only.price, currency)}, {only.available ? 'in stock' : 'out of stock'}.
        Check back after more scrape runs for a trend.
      </p>
    );
  }

  return <StoreLinesChart events={events} listings={listings} />;
}
