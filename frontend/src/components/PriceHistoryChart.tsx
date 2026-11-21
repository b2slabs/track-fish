import { useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, RefObject } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { DotProps } from 'recharts';
import { formatDateTime, formatPrice, normalizeVariantLabel } from '@/lib/format';
import type { HistoryEvent } from '@/types/data';

interface ChartPoint {
  observedAt: string;
  timestamp: number;
  price: number;
  available: boolean;
  type: HistoryEvent['type'];
}

function AvailabilityDot(props: DotProps & { payload?: ChartPoint }) {
  const { cx, cy, payload } = props;
  if (cx == null || cy == null || !payload) return null;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={4}
      fill={payload.available ? 'var(--color-chart-1, #22c55e)' : '#ef4444'}
      stroke="var(--background)"
      strokeWidth={1.5}
    />
  );
}

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: ChartPoint }>;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-sm shadow-md">
      <p className="font-medium">{formatDateTime(point.observedAt)}</p>
      <p>{formatPrice(point.price, 'USD')}</p>
      <p className={point.available ? 'text-emerald-600' : 'text-red-500'}>
        {point.available ? 'In stock' : 'Out of stock'}
      </p>
      <p className="text-xs text-muted-foreground">
        {point.type === 'change' ? 'Change event' : 'Heartbeat'}
      </p>
    </div>
  );
}

/**
 * Fixed-order categorical palette for per-Store identity (issue #23), reused
 * as the per-Store range-bar fill color (issue #35) — one shared,
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
 * One real-priced variant contributing to a `StoreBar` at one instant —
 * carried through to the tooltip so per-variant detail survives collapsing
 * variants into a single range bar (issue #35's "ideally still lists each
 * individual variant's price" acceptance criterion).
 */
interface VariantPriceDetail {
  id: string;
  label: string;
  price: number;
  available: boolean;
}

/**
 * One Store's min/max/average range bar for one observed instant (issue
 * #35) — replaces the one-line-per-variant rendering from issues #17/#23,
 * which became unreadable once a Store carried more than a couple of pack
 * sizes (e.g. Aquatic Arts' "School of 3/6/9/12").
 */
interface StoreBar {
  key: string;
  storeSlug: string;
  label: string;
  color: string;
  currency: string;
  timestamp: number;
  observedAt: string;
  type: HistoryEvent['type'];
  min: number;
  max: number;
  avg: number;
  /** Real-priced variants only, ascending by price — the tooltip's breakdown. */
  variants: VariantPriceDetail[];
  /**
   * This Store's stable first-seen index across `listings` (issue #53) —
   * the same index `seriesColor` uses for hue, reused here as the basis for
   * this Store's horizontal stagger offset so a Store's bars always nudge
   * the same direction/amount regardless of which other Stores happen to
   * share a day with it.
   */
  seriesIndex: number;
}

/** Per-Store display identity a bar needs: legend/tooltip label, fill color, currency. */
interface StoreMeta {
  label: string;
  color: string;
  currency: string;
  /** Stable first-seen index — see `StoreBar.seriesIndex`. */
  seriesIndex: number;
}

/**
 * Collapses every variant a Store had priced at one instant into a single
 * min/max/average range bar (issue #35) — one bar per Store per timestamp,
 * not one line per variant.
 *
 * Grouping key is `${storeSlug}::${timestamp}` (not per-Listing/variant), so
 * two Listings the same Store happens to carry for one Canonical Fish (see
 * `cf:sci:hyphessobrycon-sp` on the live `data` branch, where AquaHuna and
 * Imperial Tropicals each carry more than one Listing) would collapse into
 * one bar if they were ever observed at the exact same instant — true to
 * "one bar per Store per timestamp" (the issue's scope decision) — while
 * the overwhelmingly common case of independently-scraped Listings at their
 * own distinct timestamps still gets its own separate bar per observation,
 * exactly as the per-variant lines it replaces did.
 *
 * A variant priced at $0.00 is still treated as a sold-out placeholder (the
 * same rule issue #17 established for the per-variant lines) and excluded
 * from the min/max/average and from the tooltip's per-variant breakdown; an
 * instant left with no real-priced variant renders no bar at all, exactly
 * as it previously left no point on any line.
 */
function computeStoreBars(events: HistoryEvent[], storeMeta: Map<string, StoreMeta>): StoreBar[] {
  const sorted = [...events].sort(
    (a, b) => new Date(a.observedAt).getTime() - new Date(b.observedAt).getTime(),
  );

  interface Group {
    storeSlug: string;
    timestamp: number;
    observedAt: string;
    type: HistoryEvent['type'];
    variants: VariantPriceDetail[];
  }
  const groups = new Map<string, Group>();
  for (const e of sorted) {
    if (!storeMeta.has(e.storeSlug)) continue;
    const timestamp = new Date(e.observedAt).getTime();
    const key = `${e.storeSlug}::${timestamp}`;
    let group = groups.get(key);
    if (!group) {
      group = { storeSlug: e.storeSlug, timestamp, observedAt: e.observedAt, type: e.type, variants: [] };
      groups.set(key, group);
    }
    for (const v of e.variants ?? []) {
      if (v.price === 0) continue; // sold-out placeholder, not a real price
      group.variants.push({ id: v.id, label: v.label, price: v.price, available: v.available });
    }
  }

  const bars: StoreBar[] = [];
  for (const group of groups.values()) {
    if (group.variants.length === 0) continue;
    const meta = storeMeta.get(group.storeSlug)!;
    const prices = group.variants.map((v) => v.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const avg = prices.reduce((sum, p) => sum + p, 0) / prices.length;
    bars.push({
      key: `${group.storeSlug}::${group.timestamp}`,
      storeSlug: group.storeSlug,
      label: meta.label,
      color: meta.color,
      currency: meta.currency,
      timestamp: group.timestamp,
      observedAt: group.observedAt,
      type: group.type,
      min,
      max,
      avg,
      variants: [...group.variants].sort((a, b) => a.price - b.price),
      seriesIndex: meta.seriesIndex,
    });
  }
  return bars.sort((a, b) => a.timestamp - b.timestamp);
}

interface Domain {
  minT: number;
  maxT: number;
  minP: number;
  maxP: number;
}

/** Shared time+price domain every bar is plotted against, padded like Recharts' own 'auto' Y domain. */
function useBarDomain(bars: StoreBar[]): Domain | null {
  return useMemo(() => {
    if (bars.length === 0) return null;
    let minT = Infinity;
    let maxT = -Infinity;
    let minP = Infinity;
    let maxP = -Infinity;
    for (const b of bars) {
      if (b.timestamp < minT) minT = b.timestamp;
      if (b.timestamp > maxT) maxT = b.timestamp;
      if (b.min < minP) minP = b.min;
      if (b.max > maxP) maxP = b.max;
    }
    const pad = (maxP - minP) * 0.1 || Math.max(maxP, 1) * 0.1;
    return {
      minT,
      maxT: maxT === minT ? maxT + 1 : maxT,
      minP: Math.max(0, minP - pad),
      maxP: maxP + pad,
    };
  }, [bars]);
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
 * `.recharts-cartesian-grid-bg` background rect via the DOM, the same
 * technique issue #29 introduced for hover — that rect is exactly the
 * chart's plotting area in every Recharts version, so range bars drawn in
 * an absolutely-positioned overlay on top of it stay pixel-aligned with the
 * axes even as the container resizes (tracked here via `ResizeObserver`,
 * since bars must be visible on first paint, not only after a mouse move).
 *
 * `ResponsiveContainer` measures its own box and only mounts the actual
 * chart (and so `.recharts-cartesian-grid-bg`) on a follow-up render after
 * that — a real, observed race: on a cold load this effect can run before
 * that element exists yet, and since the *outer* wrapper being observed
 * here doesn't itself resize when that inner content later appears,
 * `ResizeObserver` alone never fires again and bars silently never render.
 * `requestAnimationFrame` polling bridges exactly that gap — cheap, bounded
 * to the handful of frames the element actually takes to appear — and hands
 * off to the `ResizeObserver` once the element is found for ongoing resize
 * tracking.
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

/**
 * A bar's pixel geometry: horizontal center, vertical span, and the
 * average marker's y. `isSinglePoint` is true when there's nothing to show
 * a range of — exactly one real-priced variant at this instant, so
 * min = max = average — and the overlay renders a lone point instead of a
 * stem (issue #42).
 */
interface BarGeometry {
  cx: number;
  yTop: number;
  yBottom: number;
  avgY: number;
  isSinglePoint: boolean;
}

const CAP_WIDTH = 10;
const STEM_WIDTH = 1.25;
const AVG_DOT_RADIUS = 4;
const AVG_DOT_RING_WIDTH = 2;
/**
 * Minimum rendered stem height in pixels — enforced only for a genuine
 * multi-variant range whose min and max happen to land on (or very near)
 * the same price, e.g. two pack sizes priced identically — so the stem and
 * its caps still render as a visible sliver rather than vanish entirely.
 * Does not apply to a single-variant bar: that case renders as a point,
 * not a zero-height stem (issue #42; replaces issue #35's degenerate-bar
 * minimum-height rule, which papered over the single-variant case the same
 * way instead of giving it its own point rendering).
 */
const MIN_STEM_HEIGHT_PX = 6;

const DAY_MS = 24 * 60 * 60 * 1000;
/** Smallest/largest per-step horizontal nudge a Store's stagger offset can use. */
const MIN_STAGGER_SPACING_PX = 2;
const MAX_STAGGER_SPACING_PX = 7;
/**
 * How much of one day's own pixel width the full staggered cluster (every
 * Store's offset, end to end) may spread across, at most. `cx` is
 * continuous time, so on a short/zoomed-in time range one day already spans
 * many pixels and a generous stagger reads clearly as "a few Stores sharing
 * a day"; on a long time range one day can collapse toward a single pixel,
 * and the same fixed-pixel stagger would start to look like a run of
 * separate days. Scaling the spacing to a fraction of the domain's own
 * pixels-per-day — capped either way by `MIN/MAX_STAGGER_SPACING_PX` — keeps
 * the cluster small relative to a day's own width at any zoom level, so
 * genuinely different days never get confused for one staggered cluster
 * (issue #53's "x-axis isn't misleading over longer time ranges" criterion).
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
 * nothing to stagger against.
 */
function staggerOffsetPx(
  rect: PlotRect,
  domain: Domain,
  seriesIndex: number,
  storeCount: number,
): number {
  if (storeCount <= 1) return 0;
  const span = domain.maxT - domain.minT || 1;
  const pixelsPerDay = (rect.width * DAY_MS) / span;
  const maxClusterWidth = pixelsPerDay * MAX_CLUSTER_FRACTION_OF_DAY;
  const spacing = Math.min(
    MAX_STAGGER_SPACING_PX,
    Math.max(MIN_STAGGER_SPACING_PX, maxClusterWidth / (storeCount - 1)),
  );
  return (seriesIndex - (storeCount - 1) / 2) * spacing;
}

function barGeometry(rect: PlotRect, domain: Domain, bar: StoreBar, storeCount: number): BarGeometry {
  const baseCx = rect.left + ((bar.timestamp - domain.minT) / (domain.maxT - domain.minT)) * rect.width;
  const cx = baseCx + staggerOffsetPx(rect, domain, bar.seriesIndex, storeCount);
  const priceToY = (price: number) =>
    rect.top + (1 - (price - domain.minP) / (domain.maxP - domain.minP)) * rect.height;

  if (bar.variants.length <= 1) {
    const y = priceToY(bar.avg);
    return { cx, yTop: y, yBottom: y, avgY: y, isSinglePoint: true };
  }

  let yTop = priceToY(bar.max);
  let yBottom = priceToY(bar.min);
  if (yBottom - yTop < MIN_STEM_HEIGHT_PX) {
    const center = (yTop + yBottom) / 2;
    yTop = center - MIN_STEM_HEIGHT_PX / 2;
    yBottom = center + MIN_STEM_HEIGHT_PX / 2;
  }
  const avgY = Math.min(yBottom, Math.max(yTop, priceToY(bar.avg)));
  return { cx, yTop, yBottom, avgY, isSinglePoint: false };
}

/**
 * Draws every Store's range marks as an absolutely-positioned SVG overlay
 * on top of Recharts' axes/grid (see `usePlotRect` for why marks aren't
 * plotted through Recharts' own `<Bar>`: full control over the floating
 * min-max span and the single-point fallback, mirroring this file's
 * existing precedent of overlaying custom marks on the Recharts-drawn axes
 * — see `PointHoverOverlay`'s predecessor).
 *
 * A classic range-plot reading (issue #42, replacing issue #35's filled
 * "pill" with a background-colored notch cut through at the average): a
 * thin vertical **stem** spans min to max, a horizontal **cap** tick marks
 * each exact end, and the **average** is its own filled dot riding the
 * stem — three distinct marks rather than one fill with a gap punched in
 * it. When a Store has only one real-priced variant at this instant there
 * is no range to show, so only the dot is drawn — no stem, no caps, no
 * separate average marker, since min = max = average are all the same
 * value.
 */
/**
 * How much larger than a Store's own typical observation gap counts as "too
 * large to bridge" with a connecting line (issue #53, same spirit as issue
 * #29's per-variant line-gap handling). A multiple of that Store's own
 * median gap between consecutive bars — not a fixed time span — because how
 * often *this* Store is actually observed is the only basis for calling one
 * of its own gaps anomalous rather than normal cadence.
 */
const GAP_BREAK_MULTIPLIER = 5;

/**
 * Splits one Store's own bars (already time-sorted) into runs that should
 * each be drawn as one connected line, breaking the run wherever the gap to
 * the next bar is unusually large relative to this Store's own typical
 * cadence — bridging that stretch would draw a line implying a price held
 * steady through a period this Store was never actually observed. With
 * fewer than 3 bars there's no basis for "typical", so 1-2 bars stay in a
 * single run.
 */
function splitConnectedRuns(storeBars: StoreBar[]): StoreBar[][] {
  if (storeBars.length <= 2) return storeBars.length > 0 ? [storeBars] : [];
  const gaps = storeBars.slice(1).map((b, i) => b.timestamp - storeBars[i].timestamp);
  const sortedGaps = [...gaps].sort((a, b) => a - b);
  const medianGap = sortedGaps[Math.floor(sortedGaps.length / 2)];
  const threshold = medianGap * GAP_BREAK_MULTIPLIER;

  const runs: StoreBar[][] = [[storeBars[0]]];
  gaps.forEach((gap, i) => {
    if (medianGap > 0 && gap > threshold) {
      runs.push([storeBars[i + 1]]);
    } else {
      runs[runs.length - 1].push(storeBars[i + 1]);
    }
  });
  return runs;
}

interface StoreLine {
  storeSlug: string;
  color: string;
  runs: StoreBar[][];
}

/**
 * Groups every bar by Store (preserving the time order `computeStoreBars`
 * already sorted them in) and splits each Store's own bars into
 * line-connectable runs (see `splitConnectedRuns`) — the data a Store's
 * thin trend line needs (issue #53), independent of the bars themselves.
 */
function computeStoreLines(bars: StoreBar[]): StoreLine[] {
  const byStore = new Map<string, StoreBar[]>();
  for (const bar of bars) {
    const list = byStore.get(bar.storeSlug);
    if (list) list.push(bar);
    else byStore.set(bar.storeSlug, [bar]);
  }
  const lines: StoreLine[] = [];
  for (const [storeSlug, storeBars] of byStore) {
    lines.push({ storeSlug, color: storeBars[0].color, runs: splitConnectedRuns(storeBars) });
  }
  return lines;
}

/**
 * Draws a thin trend line per Store, in that Store's own color, through its
 * own bars' average points at their stagger-adjusted x position (issue
 * #53) — restoring the visual thread across time that issue #35 removed
 * when it replaced per-variant lines with isolated per-Store bars. Rendered
 * underneath `BarsOverlay` so the stem/caps/average-dot marks always sit on
 * top of the connecting line, not the other way around.
 */
function StoreLinesOverlay({
  bars,
  rect,
  domain,
  storeCount,
}: {
  bars: StoreBar[];
  rect: PlotRect;
  domain: Domain;
  storeCount: number;
}) {
  const lines = useMemo(() => computeStoreLines(bars), [bars]);
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
      {lines.map((line) =>
        line.runs.map((run, runIdx) => {
          if (run.length < 2) return null;
          const points = run
            .map((bar) => {
              const geo = barGeometry(rect, domain, bar, storeCount);
              return `${geo.cx},${geo.avgY}`;
            })
            .join(' ');
          return (
            <polyline
              key={`${line.storeSlug}-${runIdx}`}
              points={points}
              fill="none"
              stroke={line.color}
              strokeWidth={1.5}
              strokeLinejoin="round"
              strokeLinecap="round"
              opacity={0.65}
            />
          );
        }),
      )}
    </svg>
  );
}

function BarsOverlay({
  bars,
  rect,
  domain,
  storeCount,
  hoveredKey,
}: {
  bars: StoreBar[];
  rect: PlotRect;
  domain: Domain;
  storeCount: number;
  hoveredKey?: string;
}) {
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
      {bars.map((bar) => {
        const geo = barGeometry(rect, domain, bar, storeCount);
        const isHovered = bar.key === hoveredKey;
        const opacity = isHovered ? 1 : 0.85;
        return (
          <g key={bar.key}>
            {!geo.isSinglePoint && (
              <>
                <line
                  x1={geo.cx}
                  x2={geo.cx}
                  y1={geo.yTop}
                  y2={geo.yBottom}
                  stroke={bar.color}
                  strokeWidth={STEM_WIDTH}
                  opacity={opacity}
                />
                <line
                  x1={geo.cx - CAP_WIDTH / 2}
                  x2={geo.cx + CAP_WIDTH / 2}
                  y1={geo.yTop}
                  y2={geo.yTop}
                  stroke={bar.color}
                  strokeWidth={STEM_WIDTH}
                  opacity={opacity}
                />
                <line
                  x1={geo.cx - CAP_WIDTH / 2}
                  x2={geo.cx + CAP_WIDTH / 2}
                  y1={geo.yBottom}
                  y2={geo.yBottom}
                  stroke={bar.color}
                  strokeWidth={STEM_WIDTH}
                  opacity={opacity}
                />
              </>
            )}
            <circle
              cx={geo.cx}
              cy={geo.avgY}
              r={AVG_DOT_RADIUS}
              fill={bar.color}
              stroke="var(--color-background, #fff)"
              strokeWidth={AVG_DOT_RING_WIDTH}
              opacity={opacity}
            />
            {isHovered &&
              (geo.isSinglePoint ? (
                <circle
                  cx={geo.cx}
                  cy={geo.avgY}
                  r={AVG_DOT_RADIUS + 3}
                  fill="none"
                  stroke={bar.color}
                  strokeWidth={2}
                />
              ) : (
                <rect
                  x={geo.cx - CAP_WIDTH / 2 - 3}
                  y={geo.yTop - 3}
                  width={CAP_WIDTH + 6}
                  height={geo.yBottom - geo.yTop + 6}
                  rx={4}
                  fill="none"
                  stroke={bar.color}
                  strokeWidth={2}
                />
              ))}
          </g>
        );
      })}
    </svg>
  );
}

interface BarHoverState {
  bar: StoreBar;
  left: number;
  top: number;
}

/**
 * Finds the bar genuinely nearest the cursor: zero vertical distance
 * anywhere inside a bar's own min-max span (so the whole bar — not just its
 * exact average — is the hit target, per the dataviz skill's "the mark is
 * the hit target" rule for bar/cell marks), distance to the nearer edge
 * outside it, both normalized against the plot's own pixel size so time and
 * price contribute comparably — the same normalization `useNearestPointHover`
 * used for per-variant lines (issue #29) before this chart replaced them.
 */
/**
 * Only surface a tooltip when the cursor is genuinely near a bar — beyond
 * this normalized-distance cutoff, hovering empty chart space shows
 * nothing rather than always snapping to whatever bar happens to be
 * nearest, however far away.
 */
const MAX_HOVER_DIST_SQ = 0.0025;

function useNearestBarHover(
  bars: StoreBar[],
  containerRef: RefObject<HTMLDivElement | null>,
  rect: PlotRect | null,
  domain: Domain | null,
  storeCount: number,
) {
  const [hover, setHover] = useState<BarHoverState | null>(null);

  const handleMove = (e: ReactMouseEvent<HTMLDivElement>) => {
    const container = containerRef.current;
    if (!container || !rect || !domain || bars.length === 0) return;
    const containerBox = container.getBoundingClientRect();
    const mx = e.clientX - containerBox.left;
    const my = e.clientY - containerBox.top;

    let bestBar: StoreBar | null = null;
    let bestGeo: BarGeometry | null = null;
    let bestDist = Infinity;
    for (const bar of bars) {
      const geo = barGeometry(rect, domain, bar, storeCount);
      const dx = (geo.cx - mx) / rect.width;
      let dy = 0;
      if (my < geo.yTop) dy = (geo.yTop - my) / rect.height;
      else if (my > geo.yBottom) dy = (my - geo.yBottom) / rect.height;
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) {
        bestDist = dist;
        bestBar = bar;
        bestGeo = geo;
      }
    }
    if (!bestBar || !bestGeo || bestDist > MAX_HOVER_DIST_SQ) {
      setHover(null);
      return;
    }
    setHover({ bar: bestBar, left: bestGeo.cx, top: (bestGeo.yTop + bestGeo.yBottom) / 2 });
  };

  return { hover, handleMove, handleLeave: () => setHover(null) };
}

/**
 * Floating tooltip for whatever bar `useNearestBarHover` found nearest the
 * cursor: Store, observed date, average (the headline value) with the
 * min-max span beneath it, and — issue #35's "ideally still lists each
 * individual variant's price" criterion — every real-priced variant that
 * went into this bar, struck through when that variant was out of stock at
 * the time, each variant's label passed through `normalizeVariantLabel` so
 * Shopify's raw "Title" placeholder never leaks through here either (issue
 * #42). A single-variant bar (nothing to average or range) shows just that
 * one price with no "average"/"range" framing and omits the per-variant
 * list entirely, since it would just repeat the same line.
 */
function BarHoverOverlay({ hover }: { hover: BarHoverState }) {
  const { bar, left, top } = hover;
  const flipBelow = top < 96;
  const isSingleVariant = bar.variants.length <= 1;
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
            style={{ backgroundColor: bar.color }}
          />
          {bar.label}
        </p>
        <p className="text-xs text-muted-foreground">{formatDateTime(bar.observedAt)}</p>
        {isSingleVariant ? (
          <p className="mt-1 font-medium">{formatPrice(bar.avg, bar.currency)}</p>
        ) : (
          <>
            <p className="mt-1">
              <span className="font-medium">{formatPrice(bar.avg, bar.currency)}</span>{' '}
              <span className="text-xs text-muted-foreground">average</span>
            </p>
            <p className="text-xs text-muted-foreground">
              {formatPrice(bar.min, bar.currency)} – {formatPrice(bar.max, bar.currency)} range
            </p>
            <ul className="mt-1.5 space-y-0.5 border-t pt-1.5 text-xs">
              {bar.variants.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-3">
                  <span className={v.available ? 'text-muted-foreground' : 'text-muted-foreground line-through'}>
                    {normalizeVariantLabel(v.label, bar.variants.length)}
                  </span>
                  <span className="font-medium">{formatPrice(v.price, bar.currency)}</span>
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
 * Shared chart chrome for every range-bar chart (one Store or many): the
 * Recharts axes/grid for scale and ticks, the bar overlay drawn on top of
 * them, and the nearest-bar hover tooltip. `currency` formats the Y axis
 * ticks; a Store's own bar/tooltip always uses that Store's own currency
 * (see `StoreBar.currency`), never coerced to this axis's.
 */
function RangeBarChart({ bars, axisCurrency }: { bars: StoreBar[]; axisCurrency: string }) {
  const domain = useBarDomain(bars);
  const { containerRef, rect } = usePlotRect(bars.length);
  // Total distinct Stores in this chart (not just how many share any one
  // day) — the stable denominator `staggerOffsetPx` centers each Store's
  // fixed offset against. A single-Store chart naturally lands at 1, which
  // `staggerOffsetPx` treats as "nothing to stagger against".
  const storeCount = useMemo(() => new Set(bars.map((b) => b.seriesIndex)).size, [bars]);
  const { hover, handleMove, handleLeave } = useNearestBarHover(bars, containerRef, rect, domain, storeCount);

  return (
    <div
      ref={containerRef}
      className="relative h-72 w-full"
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={bars} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
          {/* `fill="transparent"` (invisible — Recharts' default is `fill="none"`,
              which renders no background rect at all) forces Recharts to render
              its `.recharts-cartesian-grid-bg` rect, which `usePlotRect` reads via
              the DOM to know the plot area's exact pixel bounds. */}
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" fill="transparent" />
          <XAxis
            dataKey="timestamp"
            type="number"
            // Explicit numeric domain (not 'dataMin'/'dataMax') so the axis matches
            // `domain` exactly — the same domain the bar overlay's own pixel
            // mapping uses — regardless of whether any Recharts graphical child
            // (there are none; bars are a custom overlay) would otherwise
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
          {/* Invisible line keyed on each bar's average price — bars are a custom
              overlay, not a Recharts graphical child, and without any graphical
              item Recharts never generates Y-axis ticks at all (it only ticks an
              axis something is actually plotted against), leaving the Y axis
              blank even though its line/width render. This line's own values are
              never seen (`stroke="none"`, no dot, no active state) — it exists
              solely to give the Y axis a real series to tick against. */}
          <Line
            dataKey="avg"
            stroke="none"
            dot={false}
            activeDot={false}
            isAnimationActive={false}
            legendType="none"
          />
        </LineChart>
      </ResponsiveContainer>
      {rect && domain && (
        <>
          <StoreLinesOverlay bars={bars} rect={rect} domain={domain} storeCount={storeCount} />
          <BarsOverlay
            bars={bars}
            rect={rect}
            domain={domain}
            storeCount={storeCount}
            hoveredKey={hover?.bar.key}
          />
        </>
      )}
      {hover && <BarHoverOverlay hover={hover} />}
    </div>
  );
}

/**
 * One Store's Listing, as the chart needs to know it: which Store it
 * belongs to (for hue), its own currency (a Store's bar is always formatted
 * in its own currency, never coerced to another Store's), and its display
 * name for the legend.
 */
export interface ChartListing {
  listingId: string;
  storeSlug: string;
  storeName: string;
  commonName: string;
  currency: string;
}

/**
 * Renders a single Store's own range bars across time (issue #35) — one
 * bar per observed timestamp, min-to-max across that Store's variants, with
 * an average tick. Only reached when a Canonical Fish has exactly one
 * Listing with more than one variant (see dispatch in `PriceHistoryChart`
 * below) — a single Store is "a single series" for legend purposes (the
 * dataviz skill's rule: one color needs no legend box), so this renders a
 * short caption instead of a swatch legend.
 */
function SingleStoreRangeBarChart({
  events,
  listing,
}: {
  events: HistoryEvent[];
  listing: ChartListing;
}) {
  const storeMeta = useMemo(
    () =>
      new Map([
        [
          listing.storeSlug,
          { label: listing.storeName, color: seriesColor(0), currency: listing.currency, seriesIndex: 0 },
        ],
      ]),
    [listing.storeSlug, listing.storeName, listing.currency],
  );
  const bars = useMemo(() => computeStoreBars(events, storeMeta), [events, storeMeta]);

  return (
    <div className="w-full">
      <RangeBarChart bars={bars} axisCurrency={listing.currency} />
    </div>
  );
}

/**
 * Renders ONE price/availability chart across every Store carrying a
 * Canonical Fish (issue #23), with each Store's own variants collapsed into
 * one min/max/average range bar per timestamp (issue #35) rather than one
 * line per (Listing, variant) pair. Hue still identifies the Store, in the
 * same fixed first-seen order as before. Only reached when a Canonical Fish
 * has more than one Listing; see dispatch below.
 */
function UnifiedRangeBarChart({ events, listings }: { events: HistoryEvent[]; listings: ChartListing[] }) {
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
  const bars = useMemo(() => computeStoreBars(events, storeMeta), [events, storeMeta]);
  const currencies = new Set(listings.map((l) => l.currency));
  // The Y axis is one shared scale across every Store's bars; when Stores
  // price in different currencies, format ticks in the first Store's
  // currency as a best-effort axis label and point readers to the tooltip
  // (always formatted per-Store, in that Store's own currency) for the
  // exact figure.
  const axisCurrency = listings[0]?.currency ?? 'USD';

  return (
    <div className="w-full">
      <RangeBarChart bars={bars} axisCurrency={axisCurrency} />
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
            Stores shown price in different currencies — the axis is approximate; hover a mark
            for the exact prices and currency per Store.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Renders a Canonical Fish's historical price/availability chart from its
 * history events — one unified chart across every Store carrying it (issue
 * #23), with every Store's variants collapsed into one min/max/average
 * range bar per timestamp rather than one line per variant (issue #35).
 * `listings` must contain exactly the Listings whose events appear in
 * `events` (the Listings a Canonical Fish currently has, from the index).
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

  // More than one Listing (whether from different Stores, or the same
  // Store carrying two Listings for this Canonical Fish) gets the unified
  // multi-Store range-bar chart (issues #23/#35). Exactly one Listing — the
  // common case — falls through unchanged to the single-Store range-bar
  // chart or the original single-line chart below: no regression, no
  // empty/confusing legend.
  const distinctListingIds = new Set(listings.map((l) => l.listingId));
  if (distinctListingIds.size > 1) {
    return <UnifiedRangeBarChart events={events} listings={listings} />;
  }

  const distinctVariantIds = new Set<string>();
  for (const e of events) {
    for (const v of e.variants ?? []) distinctVariantIds.add(v.id);
  }
  if (distinctVariantIds.size > 1 && listings[0]) {
    return <SingleStoreRangeBarChart events={events} listing={listings[0]} />;
  }

  const points: ChartPoint[] = events
    .map((e) => ({
      observedAt: e.observedAt,
      timestamp: new Date(e.observedAt).getTime(),
      price: e.price,
      available: e.available,
      type: e.type,
    }))
    .sort((a, b) => a.timestamp - b.timestamp);

  return (
    <div className="w-full">
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis
              dataKey="timestamp"
              type="number"
              domain={['dataMin', 'dataMax']}
              tickFormatter={(ts: number) =>
                new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(
                  new Date(ts),
                )
              }
              className="text-xs"
            />
            <YAxis
              dataKey="price"
              tickFormatter={(p: number) => formatPrice(p, currency)}
              width={80}
              domain={['auto', 'auto']}
              className="text-xs"
            />
            <Tooltip content={<ChartTooltip />} />
            <Line
              type="stepAfter"
              dataKey="price"
              stroke="currentColor"
              className="text-primary"
              strokeWidth={2}
              dot={<AvailabilityDot />}
              activeDot={{ r: 6 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        <span className="mr-3">
          <span className="inline-block size-2 rounded-full bg-emerald-500" /> In stock
        </span>
        <span>
          <span className="inline-block size-2 rounded-full bg-red-500" /> Out of stock
        </span>
      </p>
    </div>
  );
}
