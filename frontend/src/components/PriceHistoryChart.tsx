import { useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, RefObject } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { formatDateTime, formatPrice, normalizeVariantLabel } from '@/lib/format';
import type { HistoryEvent } from '@/types/data';
import { singlePointStubPath } from './price-history-chart-geometry';

/**
 * Per-variant price history chart (issue #75) — replaces the median-per-Store
 * step-line design (issue #59) entirely, not an addition alongside it.
 *
 * Issue #59 collapsed every currently-available variant within a Store into
 * one median value per observed instant, which hid real information: e.g.
 * Aquatic Arts' "School of 3/6/9/12" pack sizes each have their own price,
 * and blending them into one number lost that. This version draws ONE
 * continuous step-line per **variant** (identified by its Shopify variant
 * id, scoped to the Store+Listing it belongs to) instead — a Store with N
 * variants gets N lines, all sharing that Store's color (see
 * `SERIES_COLOR_VARS`) and each told apart from its siblings by line style
 * (`DASH_PATTERNS`), not color, since color here is store identity, not
 * variant identity.
 *
 * The other half of this issue: issue #59 inherited issue #53's "break the
 * line when a Store's own silent gap is unusually large relative to its
 * typical cadence" heuristic, and that issue's own implementation flagged it
 * as a known limitation — bursty/irregular scrape timing (long overnight
 * gaps between a cluster of heartbeats, for instance) could split a line
 * even though nothing was ever actually out of stock. This version drops
 * that heuristic completely: a variant's line breaks ONLY where there is
 * hard evidence that specific variant was unavailable in between two
 * observations (`available: false`, the `price === 0` sold-out placeholder,
 * or the variant being entirely absent from a later observation of the same
 * Listing it used to appear in — Shopify's product payload lists every
 * currently-defined variant, so a previously-seen variant missing from a
 * later scrape means it was removed/sold through, not "the scraper didn't
 * mention it this time"). A silent gap with no such evidence — however
 * long, however irregular — is always bridged. See `computeVariantLines`.
 *
 * Issue #81 removed the dense daily Heartbeat trail entirely (replaced by a
 * single `lastCheckedAt` pointer per Listing — see
 * `docs/adr/0005-heartbeat-events-replaced-by-lastcheckedat.md`), which
 * otherwise would have left a currently-unchanged variant's line stopping
 * dead at its last Change Event, looking abandoned rather than "still
 * tracked, just unchanged." `computeVariantLines` now extends a variant's
 * final run flat out to its Listing's own `lastCheckedAt` — the
 * authoritative "confirmed observed through this date" signal — UNLESS the
 * variant's own last known state is already a gap (unavailable/missing),
 * in which case it stays ended exactly where the evidence says it should.
 */

/**
 * Fixed-order categorical palette for per-Store identity (issue #23), reused
 * unchanged here as each Store's color across every one of its variant
 * lines (issue #59/#75 inherit this straight from the superseded range-bar
 * design, issue #35) — one shared, already-validated 8-hue palette, never
 * two independent color schemes layered on the same chart.
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
 * Secondary-encoding line styles for telling a Store's own variants apart
 * (issue #75's acceptance criterion) — color is already spoken for by Store
 * identity, so a Store's second, third, … variant line is distinguished by
 * `strokeDasharray` instead. `undefined` (solid) is always slot 0, so the
 * overwhelmingly common single-variant-per-Store case renders exactly the
 * plain solid line issue #59 already drew — no visual regression there.
 * Assigned by first-seen order of a variant id within its Store (mirrors
 * `seriesColor`'s rule: identity-stable, never re-ranked by price), and
 * cycles past the end of this list the same way colors cycle past 8 — the
 * legend/tooltip's text label (Store name + variant label) is what actually
 * disambiguates a high-cardinality Store, same "relief channel" the color
 * palette's own doc comment relies on.
 */
const DASH_PATTERNS: (string | undefined)[] = [
  undefined, // solid
  '7 4', // dashed
  '1.5 3', // dotted
  '8 3 2 3', // dash-dot
  '3 3', // fine dashed
];

function dashPattern(index: number): string | undefined {
  return DASH_PATTERNS[index % DASH_PATTERNS.length];
}

/** Per-Store display identity a line needs: legend/tooltip label, color, currency, stagger basis. */
interface StoreMeta {
  label: string;
  color: string;
  currency: string;
  /** Stable first-seen index across `listings` — drives both `seriesColor` and the same-day stagger offset. */
  seriesIndex: number;
}

/** One real observation of one variant's line, in stepAfter order. */
interface VariantPoint {
  key: string;
  timestamp: number;
  observedAt: string;
  price: number;
}

/**
 * One variant's continuous price line (issue #75) — identified by the
 * Shopify variant id it tracks within one Store's Listing. Carries its own
 * Store's color (never a variant-specific hue; see `DASH_PATTERNS`'s doc)
 * and its own dash style, split into `runs`: each run is one unbroken
 * stretch of real observations, broken only on hard evidence of that exact
 * variant being unavailable (see `computeVariantLines`).
 */
interface VariantLine {
  key: string;
  storeSlug: string;
  storeLabel: string;
  variantLabel: string;
  color: string;
  dash?: string;
  currency: string;
  /** This line's Store's stable first-seen index — see `StoreMeta.seriesIndex`. */
  seriesIndex: number;
  runs: VariantPoint[][];
}

/**
 * Groups every event by `listingId`, then — within each Listing — tracks
 * every variant id that has ever appeared in one of its events as its own
 * independent timeline, in first-appearance order (so a later-introduced
 * pack size doesn't retroactively grow a leading "out of stock" stretch
 * before it existed).
 *
 * For each timeline, an event is read one of three ways:
 *   - the variant is present, `available`, and carries a real nonzero price
 *     → a renderable point (`price === 0` is this project's established
 *     sold-out placeholder convention, issue #17, unchanged).
 *   - the variant is present but `available: false` or priced at the
 *     placeholder → hard evidence this variant was out of stock at this
 *     instant.
 *   - the variant is entirely absent from this event's `variants` array,
 *     despite having appeared in an earlier event for this same Listing →
 *     also hard evidence (Shopify's product payload always lists every
 *     variant currently defined on the product, so a variant that used to
 *     be there and now isn't was removed/sold through, not merely
 *     unreported).
 *
 * Only the second and third cases ever break a run — a long silent stretch
 * with neither kind of evidence (e.g. scraper downtime, or just this
 * Listing's own irregular/bursty polling cadence) is always bridged. This
 * is the issue #75 fix: issue #59 (inheriting issue #53's heuristic) broke
 * lines on unusually large silent gaps even with no evidence anything was
 * ever out of stock, which is exactly the over-splitting this drops.
 *
 * Issue #81: once every variant's events are accounted for, a variant whose
 * last known state is a real, in-stock observation (not a gap) gets one
 * more synthetic point appended to its final run — same price, timestamp
 * at its own Listing's `lastCheckedAt` — so the line visibly continues up
 * to "now" instead of stopping dead at whatever Change Event happened to
 * be most recent. A variant whose last known state is already a gap is left
 * exactly as evidence says: ended there, no synthetic continuation.
 */
function computeVariantLines(
  events: HistoryEvent[],
  storeMeta: Map<string, StoreMeta>,
  lastCheckedAtByListing: Map<string, string>,
): VariantLine[] {
  const sorted = [...events]
    .filter((e) => storeMeta.has(e.storeSlug))
    .sort((a, b) => new Date(a.observedAt).getTime() - new Date(b.observedAt).getTime());

  // First-seen dash-style index per (storeSlug, variantId), assigned in true
  // chronological order across every Listing that Store carries — not per
  // Listing — so a Store's variants keep a stable style regardless of which
  // Listing group happens to be processed first below.
  const dashIndexByStoreVariant = new Map<string, number>();
  const dashCounterByStore = new Map<string, number>();
  for (const e of sorted) {
    for (const v of e.variants ?? []) {
      const key = `${e.storeSlug}::${v.id}`;
      if (dashIndexByStoreVariant.has(key)) continue;
      const next = dashCounterByStore.get(e.storeSlug) ?? 0;
      dashIndexByStoreVariant.set(key, next);
      dashCounterByStore.set(e.storeSlug, next + 1);
    }
  }

  interface ListingGroup {
    storeSlug: string;
    events: HistoryEvent[];
  }
  const byListing = new Map<string, ListingGroup>();
  for (const e of sorted) {
    const group = byListing.get(e.listingId);
    if (group) group.events.push(e);
    else byListing.set(e.listingId, { storeSlug: e.storeSlug, events: [e] });
  }

  interface Accum {
    variantId: string;
    label: string;
    siblingCount: number;
    runs: VariantPoint[][];
    sawGapEvidence: boolean;
  }

  const lines: VariantLine[] = [];
  for (const [listingId, group] of byListing) {
    const meta = storeMeta.get(group.storeSlug)!;
    // Map preserves insertion order — first-seen order of a variant id
    // within THIS Listing, which is what decides whether a silent leading
    // stretch before it ever appeared counts as "out of stock" (it doesn't).
    const accums = new Map<string, Accum>();

    for (const e of group.events) {
      const eventVariantIds = new Set<string>();
      const eventSiblingCount = (e.variants ?? []).length;
      const timestamp = new Date(e.observedAt).getTime();

      for (const v of e.variants ?? []) {
        eventVariantIds.add(v.id);
        let acc = accums.get(v.id);
        if (!acc) {
          acc = { variantId: v.id, label: v.label, siblingCount: eventSiblingCount, runs: [], sawGapEvidence: false };
          accums.set(v.id, acc);
        }
        acc.label = v.label;
        acc.siblingCount = eventSiblingCount;

        if (v.available && v.price !== 0) {
          const point: VariantPoint = {
            key: `${listingId}::${v.id}::${timestamp}`,
            timestamp,
            observedAt: e.observedAt,
            price: v.price,
          };
          if (acc.runs.length === 0 || acc.sawGapEvidence) acc.runs.push([point]);
          else acc.runs[acc.runs.length - 1].push(point);
          acc.sawGapEvidence = false;
        } else {
          acc.sawGapEvidence = true;
        }
      }

      // Any variant that has already appeared at least once but is missing
      // from THIS event is hard evidence too (see this function's doc).
      for (const acc of accums.values()) {
        if (!eventVariantIds.has(acc.variantId)) acc.sawGapEvidence = true;
      }
    }

    // Issue #81: extend each variant's final run flat out to this Listing's
    // own lastCheckedAt, as long as its last known state isn't already a
    // gap (sawGapEvidence) -- see this function's doc. Done once per
    // Listing (not per variant fetch) since every variant on one Listing
    // shares the same lastCheckedAt.
    const lastCheckedAt = lastCheckedAtByListing.get(listingId);
    const lastCheckedTimestamp = lastCheckedAt ? new Date(lastCheckedAt).getTime() : undefined;
    if (lastCheckedTimestamp != null) {
      for (const acc of accums.values()) {
        if (acc.sawGapEvidence || acc.runs.length === 0) continue;
        const lastRun = acc.runs[acc.runs.length - 1];
        const lastPoint = lastRun[lastRun.length - 1];
        if (lastCheckedTimestamp <= lastPoint.timestamp) continue; // nothing to extend
        lastRun.push({
          key: `${listingId}::${acc.variantId}::lastChecked::${lastCheckedTimestamp}`,
          timestamp: lastCheckedTimestamp,
          observedAt: lastCheckedAt!,
          price: lastPoint.price,
        });
      }
    }

    for (const acc of accums.values()) {
      if (acc.runs.length === 0) continue; // never had a real point to draw
      const dashIdx = dashIndexByStoreVariant.get(`${group.storeSlug}::${acc.variantId}`) ?? 0;
      lines.push({
        key: `${listingId}::${acc.variantId}`,
        storeSlug: group.storeSlug,
        storeLabel: meta.label,
        variantLabel: normalizeVariantLabel(acc.label, acc.siblingCount),
        color: meta.color,
        dash: dashPattern(dashIdx),
        currency: meta.currency,
        seriesIndex: meta.seriesIndex,
        runs: acc.runs,
      });
    }
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
function useLineDomain(lines: VariantLine[]): Domain | null {
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
          if (p.price < minP) minP = p.price;
          if (p.price > maxP) maxP = p.price;
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

const DAY_MS = 24 * 60 * 60 * 1000;
/** Smallest/largest per-step horizontal nudge a Store's stagger offset can use. */
const MIN_STAGGER_SPACING_PX = 2;
const MAX_STAGGER_SPACING_PX = 7;
/**
 * How much of one day's own pixel width the full staggered cluster (every
 * Store's offset, end to end) may spread across, at most (issue #53,
 * carried into the per-variant redesign per issue #75's "same-day bars/
 * points stay staggered" criterion). `cx` is continuous time, so on a
 * short/zoomed-in time range one day already spans many pixels and a
 * generous stagger reads clearly as "a few Stores sharing a day"; on a long
 * time range one day can collapse toward a single pixel, and the same
 * fixed-pixel stagger would start to look like a run of separate days.
 * Scaling the spacing to a fraction of the domain's own pixels-per-day —
 * capped either way by `MIN/MAX_STAGGER_SPACING_PX` — keeps the cluster
 * small relative to a day's own width at any zoom level.
 */
const MAX_CLUSTER_FRACTION_OF_DAY = 0.5;

/**
 * This Store's horizontal pixel nudge, stable for the life of the chart
 * (depends only on `seriesIndex` and the overall domain/store count, never
 * on which other Stores happen to share a particular day — issue #53).
 * Offsets are centered on zero and evenly spaced by `seriesIndex`, so a
 * cluster of Stores observed on the same day fans out symmetrically around
 * that day's true x position instead of drifting the whole cluster to one
 * side. A single-Store chart (`storeCount <= 1`) always gets zero offset —
 * nothing to stagger against. Applied uniformly to every one of a Store's
 * variant lines (issue #75): they move together as one cluster, so a
 * Store's own variants stay comparable to each other while the whole
 * cluster separates from another Store's.
 */
function staggerOffsetPx(rect: PlotRect, domain: Domain, seriesIndex: number, storeCount: number): number {
  if (storeCount <= 1) return 0;
  const span = domain.maxT - domain.minT || 1;
  const pixelsPerDay = (rect.width * DAY_MS) / span;
  const maxClusterWidth = pixelsPerDay * MAX_CLUSTER_FRACTION_OF_DAY;
  const spacing = Math.min(
    MAX_STAGGER_SPACING_PX,
    Math.max(MIN_STAGGER_SPACING_PX, maxClusterWidth / Math.max(storeCount - 1, 1)),
  );
  return (seriesIndex - (storeCount - 1) / 2) * spacing;
}

/** Maps one point's (timestamp, price) to pixel coordinates inside `rect`, staggered by its line's Store. */
function pointXY(
  rect: PlotRect,
  domain: Domain,
  point: VariantPoint,
  seriesIndex: number,
  storeCount: number,
): { cx: number; cy: number } {
  const baseCx = rect.left + ((point.timestamp - domain.minT) / (domain.maxT - domain.minT)) * rect.width;
  const cx = baseCx + staggerOffsetPx(rect, domain, seriesIndex, storeCount);
  const cy = rect.top + (1 - (point.price - domain.minP) / (domain.maxP - domain.minP)) * rect.height;
  return { cx, cy };
}

/**
 * Builds one run's SVG path in "stepAfter" shape (the same step convention
 * this file already used before issue #75): flat at a point's own price
 * until the next point's timestamp, then a vertical jump exactly at that
 * timestamp. `H` (horizontal-to) then `V` (vertical-to) per subsequent point
 * does exactly that, since the path cursor is left at the previous point's
 * y after each `H`.
 */
function stepPath(
  rect: PlotRect,
  domain: Domain,
  run: VariantPoint[],
  seriesIndex: number,
  storeCount: number,
): string {
  if (run.length === 0) return '';
  const first = pointXY(rect, domain, run[0], seriesIndex, storeCount);
  let d = `M ${first.cx} ${first.cy}`;
  for (let i = 1; i < run.length; i++) {
    const { cx, cy } = pointXY(rect, domain, run[i], seriesIndex, storeCount);
    d += ` H ${cx} V ${cy}`;
  }
  return d;
}

const POINT_RADIUS = 3;
const POINT_RADIUS_HOVERED = 5.5;
const POINT_RING_WIDTH = 1.5;
const LINE_WIDTH = 2;

/**
 * A short line-style swatch (color + dash) used both in the legend and the
 * tooltip header — the one visual token that actually shows a variant's
 * dash style (a plain color square can't), so legend and tooltip always
 * agree on what identifies a line.
 */
function LineSwatch({ color, dash }: { color: string; dash?: string }) {
  return (
    <svg width="16" height="10" viewBox="0 0 16 10" className="shrink-0" aria-hidden="true">
      <line
        x1="1"
        y1="5"
        x2="15"
        y2="5"
        stroke={color}
        strokeWidth={2}
        strokeDasharray={dash}
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Draws every variant's step-line as an absolutely-positioned SVG overlay on
 * top of Recharts' axes/grid (see `usePlotRect` for why: full control over
 * the per-run step path and the genuine gap between runs, which a native
 * Recharts `<Line>` can't give us here — Stores/variants are observed on
 * independent schedules, so a single shared x-axis dataset would force
 * spurious breaks into a line at every *other* line's observation time, not
 * just its own). A run of exactly one point (nothing to connect it to,
 * isolated on both sides by a gap) renders as a short line-style stub (see
 * `singlePointStubPath`, issue #89) plus the usual point marker, rather than
 * either a zero-length path or a lone dot with no line-like styling — same
 * color/dash/width as a multi-point run, so point count alone never reads
 * as a different line style.
 */
function LinesOverlay({
  lines,
  rect,
  domain,
  storeCount,
  hoveredKey,
}: {
  lines: VariantLine[];
  rect: PlotRect;
  domain: Domain;
  storeCount: number;
  hoveredKey?: string;
}) {
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
      {lines.map((line) =>
        line.runs.map((run, runIdx) => {
          if (run.length === 0) return null;
          if (run.length === 1) {
            // Issue #89: isolated on both sides by a gap, so there's no
            // neighboring point to draw a real step to — but it still needs
            // to read as "this Store's line", not a plain dot, so it gets
            // the same short line-style stub + point marker a multi-point
            // run's own points are drawn with below.
            const { cx, cy } = pointXY(rect, domain, run[0], line.seriesIndex, storeCount);
            const isHovered = run[0].key === hoveredKey;
            return (
              <g key={`${line.key}-${runIdx}`}>
                <path
                  d={singlePointStubPath(cx, cy)}
                  fill="none"
                  stroke={line.color}
                  strokeWidth={LINE_WIDTH}
                  strokeDasharray={line.dash}
                  strokeLinecap="round"
                />
                <circle
                  cx={cx}
                  cy={cy}
                  r={isHovered ? POINT_RADIUS_HOVERED : POINT_RADIUS}
                  fill={line.color}
                  stroke="var(--color-background, #fff)"
                  strokeWidth={POINT_RING_WIDTH}
                />
              </g>
            );
          }
          return (
            <g key={`${line.key}-${runIdx}`}>
              <path
                d={stepPath(rect, domain, run, line.seriesIndex, storeCount)}
                fill="none"
                stroke={line.color}
                strokeWidth={LINE_WIDTH}
                strokeDasharray={line.dash}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {run.map((p) => {
                const { cx, cy } = pointXY(rect, domain, p, line.seriesIndex, storeCount);
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
  line: VariantLine;
  point: VariantPoint;
  left: number;
  top: number;
}

/**
 * Only surface a tooltip when the cursor is genuinely near a point — beyond
 * this normalized-distance cutoff, hovering empty chart space (including
 * anywhere inside a gap, where there's nothing to snap to) shows nothing
 * rather than always latching onto whatever point happens to be nearest,
 * however far away. Same validated cutoff issues #29/#47/#53/#59 used.
 */
const MAX_HOVER_DIST_SQ = 0.0025;

/**
 * Finds the point genuinely nearest the cursor across every variant line,
 * normalizing both axes against the plot's own pixel size so time and price
 * contribute comparably (issue #29).
 */
function useNearestPointHover(
  lines: VariantLine[],
  storeCount: number,
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

    let bestLine: VariantLine | null = null;
    let bestPoint: VariantPoint | null = null;
    let bestXY: { cx: number; cy: number } | null = null;
    let bestDist = Infinity;
    for (const line of lines) {
      for (const run of line.runs) {
        for (const p of run) {
          const xy = pointXY(rect, domain, p, line.seriesIndex, storeCount);
          const dx = (xy.cx - mx) / rect.width;
          const dy = (xy.cy - my) / rect.height;
          const dist = dx * dx + dy * dy;
          if (dist < bestDist) {
            bestDist = dist;
            bestLine = line;
            bestPoint = p;
            bestXY = xy;
          }
        }
      }
    }
    if (!bestLine || !bestPoint || !bestXY || bestDist > MAX_HOVER_DIST_SQ) {
      setHover(null);
      return;
    }
    setHover({ line: bestLine, point: bestPoint, left: bestXY.cx, top: bestXY.cy });
  };

  return { hover, handleMove, handleLeave: () => setHover(null) };
}

/**
 * Floating tooltip for whatever point `useNearestPointHover` found nearest
 * the cursor: Store (swatch matches the line's own color+dash), the
 * variant's own normalized label, observed date, and its own price. Unlike
 * the superseded median design there is nothing to break down further here
 * — one point is already exactly one variant's own observation.
 */
function PointHoverOverlay({ hover }: { hover: PointHoverState }) {
  const { line, point, left, top } = hover;
  const flipBelow = top < 96;
  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      <div
        className={`absolute -translate-x-1/2 rounded-md border bg-popover px-3 py-2 text-sm shadow-md ${
          flipBelow ? 'translate-y-3' : '-translate-y-[calc(100%+12px)]'
        }`}
        style={{ left, top, minWidth: '11rem' }}
      >
        <p className="mb-1 flex items-center gap-1.5 font-medium">
          <LineSwatch color={line.color} dash={line.dash} />
          {line.storeLabel}
        </p>
        <p className="text-xs text-muted-foreground">{line.variantLabel}</p>
        <p className="text-xs text-muted-foreground">{formatDateTime(point.observedAt)}</p>
        <p className="mt-1 font-medium">{formatPrice(point.price, line.currency)}</p>
      </div>
    </div>
  );
}

/**
 * Shared chart chrome for every per-variant step-line chart (one line or
 * many): the Recharts axes/grid for scale and ticks, the step-line overlay
 * drawn on top of them, and the nearest-point hover tooltip. `axisCurrency`
 * formats the Y axis ticks; a line's own point/tooltip always uses that
 * line's own Store's currency, never coerced to this axis's.
 */
function StepLineChart({ lines, axisCurrency }: { lines: VariantLine[]; axisCurrency: string }) {
  const domain = useLineDomain(lines);
  const storeCount = useMemo(() => new Set(lines.map((l) => l.storeSlug)).size, [lines]);
  const allPoints = useMemo(() => lines.flatMap((l) => l.runs.flat()), [lines]);
  const { containerRef, rect } = usePlotRect(allPoints.length);
  const { hover, handleMove, handleLeave } = useNearestPointHover(
    lines,
    storeCount,
    containerRef,
    rect,
    domain,
  );

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
          {/* Invisible line keyed on each point's price — points are a custom
              overlay, not a Recharts graphical child, and without any graphical item
              Recharts never generates Y-axis ticks at all (it only ticks an axis
              something is actually plotted against), leaving the Y axis blank even
              though its line/width render. This line's own values are never seen
              (`stroke="none"`, no dot, no active state) — it exists solely to give
              the Y axis a real series to tick against. */}
          <Line
            dataKey="price"
            stroke="none"
            dot={false}
            activeDot={false}
            isAnimationActive={false}
            legendType="none"
          />
        </LineChart>
      </ResponsiveContainer>
      {rect && domain && (
        <LinesOverlay
          lines={lines}
          rect={rect}
          domain={domain}
          storeCount={storeCount}
          hoveredKey={hover?.point.key}
        />
      )}
      {hover && <PointHoverOverlay hover={hover} />}
    </div>
  );
}

/**
 * One Store's Listing, as the chart needs to know it: which Store it
 * belongs to (for hue), its own currency (a Store's line is always
 * formatted in its own currency, never coerced to another Store's), its
 * display name for the legend, and (issue #81) the authoritative date it
 * was last confirmed observed — used to extend its variants' lines flat up
 * to that date instead of stopping dead at the last Change Event.
 */
export interface ChartListing {
  listingId: string;
  storeSlug: string;
  storeName: string;
  commonName: string;
  currency: string;
  lastCheckedAt: string;
}

/**
 * Renders a Canonical Fish's price/availability chart as one step-line per
 * variant per Store (issue #75) — every variant keeps its own continuous
 * price trend, with a genuine gap only where there's hard evidence that
 * exact variant was out of stock. Handles every case uniformly: a single
 * Listing with a single variant (one solid line, identical to issue #59's
 * single-variant case — no regression), a single Listing with several
 * variants (same color, each a different dash style), and several
 * Listings/Stores together (each Store's own color, each of its variants
 * its own dash, same-day clusters staggered apart). A legend is only worth
 * showing once there's more than one line to tell apart.
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
  const lastCheckedAtByListing = useMemo(
    () => new Map(listings.map((l) => [l.listingId, l.lastCheckedAt])),
    [listings],
  );
  const lines = useMemo(
    () => computeVariantLines(events, storeMeta, lastCheckedAtByListing),
    [events, storeMeta, lastCheckedAtByListing],
  );
  const currencies = new Set(listings.map((l) => l.currency));
  // The Y axis is one shared scale across every line; when Stores price in
  // different currencies, format ticks in the first Store's currency as a
  // best-effort axis label and point readers to the tooltip (always
  // formatted per-line, in that line's own Store's currency) for the exact
  // figure.
  const axisCurrency = listings[0]?.currency ?? 'USD';
  const showLegend = lines.length > 1;

  // Group lines by Store (in that Store's stable first-seen order) for the
  // legend: a Store with exactly one line shows a plain swatch + its name
  // (identical to issue #59's legend row); a Store with several shows its
  // name once followed by one swatch+label row per variant, since those
  // lines share a color and only their dash style/label tell them apart.
  const byStore = useMemo(() => {
    const groups = new Map<string, VariantLine[]>();
    for (const line of lines) {
      const list = groups.get(line.storeSlug);
      if (list) list.push(line);
      else groups.set(line.storeSlug, [line]);
    }
    return Array.from(storeMeta.entries())
      .filter(([slug]) => groups.has(slug))
      .map(([slug, meta]) => ({ slug, meta, lines: groups.get(slug)! }));
  }, [lines, storeMeta]);

  return (
    <div className="w-full">
      <StepLineChart lines={lines} axisCurrency={axisCurrency} />
      {showLegend && (
        <div className="mt-2 space-y-2 text-xs text-muted-foreground">
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {byStore.map(({ slug, meta, lines: storeLines }) =>
              storeLines.length === 1 ? (
                <span key={slug} className="inline-flex items-center gap-1.5">
                  <span
                    className="inline-block size-2.5 shrink-0 rounded-[2px]"
                    style={{ backgroundColor: meta.color }}
                  />
                  {meta.label}
                </span>
              ) : (
                <div key={slug} className="flex flex-col gap-1">
                  <span className="font-medium text-foreground">{meta.label}</span>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 pl-0.5">
                    {storeLines.map((line) => (
                      <span key={line.key} className="inline-flex items-center gap-1.5">
                        <LineSwatch color={line.color} dash={line.dash} />
                        {line.variantLabel}
                      </span>
                    ))}
                  </div>
                </div>
              ),
            )}
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
 * history events — one step-line per variant per Store carrying it (issue
 * #75), with a genuine gap only where there's hard evidence that exact
 * variant was out of stock. `listings` must contain exactly the Listings
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
