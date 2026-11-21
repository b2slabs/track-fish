import { useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { DotProps } from 'recharts';
import { formatDateTime, formatPrice } from '@/lib/format';
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
 * Fixed-order categorical palette for per-variant lines (issue #17), reused
 * for per-Store lines (issue #23) — one shared, already-validated 8-hue
 * palette, never two independent color schemes layered on the same chart.
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
 * Assigns a slot its color by stable index (first-seen order — a variant's
 * first-seen order within a Listing for #17, a Store's first-seen order
 * across Listings for #23 — never by current price rank), so an entity
 * keeps its color as siblings come and go in the underlying data. Past the
 * 8 validated hues (an edge case — not the common case) colors cycle rather
 * than inventing an ungoverned 9th hue; the legend's text label remains the
 * authoritative way to tell those apart.
 */
function seriesColor(index: number): string {
  return SERIES_COLOR_VARS[index % SERIES_COLOR_VARS.length];
}

/**
 * Dash patterns used as the *secondary* encoding layered on top of a
 * Store's hue (issue #23) — distinguishing multiple series within one
 * Store (its own variants, or — see `cf:sci:danio-margaritatus-aka` on the
 * live `data` branch — multiple Listings the same Store carries for one
 * Canonical Fish) without inventing a second, ungoverned color per Store.
 * Index 0 (solid) matches today's single-series-per-Store rendering
 * exactly, so a Store contributing just one series is visually unchanged.
 * Cycles past 4 (an edge case) — same rationale as `seriesColor` above.
 */
const DASH_PATTERNS: Array<string | undefined> = [undefined, '6 3', '2 3', '10 3 2 3'];

function dashPattern(index: number): string | undefined {
  return DASH_PATTERNS[index % DASH_PATTERNS.length];
}

interface VariantMeta {
  id: string;
  label: string;
}

interface MultiVariantPoint {
  observedAt: string;
  timestamp: number;
  type: HistoryEvent['type'];
  /** `price__<variantId>` -> number | null, `avail__<variantId>` -> boolean. */
  [key: string]: unknown;
}

function priceKey(id: string): string {
  return `price__${id}`;
}

function availKey(id: string): string {
  return `avail__${id}`;
}

/**
 * Builds one row per history event, carrying every variant's price
 * (or `null` when absent) alongside its own availability, plus the
 * stable, first-seen-order list of variants to render as lines.
 *
 * A variant priced at $0.00 is almost certainly a sold-out placeholder
 * (per issue #17's reported example), not a real price — it is recorded
 * as `null` here so the chart leaves a gap instead of plotting a price
 * that fell to zero.
 */
function buildVariantSeries(events: HistoryEvent[]): {
  variants: VariantMeta[];
  points: MultiVariantPoint[];
} {
  const sorted = [...events].sort(
    (a, b) => new Date(a.observedAt).getTime() - new Date(b.observedAt).getTime(),
  );

  const variants: VariantMeta[] = [];
  const seen = new Set<string>();
  for (const e of sorted) {
    for (const v of e.variants ?? []) {
      if (!seen.has(v.id)) {
        seen.add(v.id);
        variants.push({ id: v.id, label: v.label });
      }
    }
  }

  const points: MultiVariantPoint[] = sorted.map((e) => {
    const point: MultiVariantPoint = {
      observedAt: e.observedAt,
      timestamp: new Date(e.observedAt).getTime(),
      type: e.type,
    };
    for (const meta of variants) {
      const v = (e.variants ?? []).find((x) => x.id === meta.id);
      if (!v) {
        point[priceKey(meta.id)] = null;
        point[availKey(meta.id)] = false;
        continue;
      }
      point[priceKey(meta.id)] = v.price === 0 ? null : v.price;
      point[availKey(meta.id)] = v.available;
    }
    return point;
  });

  return { variants, points };
}

/**
 * One series' own real observation, already stripped of every other
 * series' keys (issue #29) — the shape each per-series/per-run `<Line
 * data={...}>` plots directly, and what the custom nearest-point hover
 * below compares the cursor against. `key`/`label`/`color`/`currency`
 * identify which series/Store the point belongs to.
 */
interface SeriesPoint {
  key: string;
  label: string;
  color: string;
  currency: string;
  timestamp: number;
  observedAt: string;
  price: number;
  available: boolean;
  type: HistoryEvent['type'];
}

/**
 * Pulls one series' real observations (non-null, non-$0.00-placeholder)
 * out of the combined per-event matrix built by `buildVariantSeries`/
 * `buildUnifiedSeries`, in the time order `points` is already sorted in.
 * `price == null` catches both: a row that is genuinely this series' own
 * event with a `null` (sold-out $0.00) price, and a row that is some
 * *other* series' event where this series' key was never set at all
 * (`undefined`, the Unified chart's sparse case) — both mean "nothing to
 * plot for this series here".
 */
function extractSeriesPoints(
  points: MultiVariantPoint[],
  id: string,
  meta: { key: string; label: string; color: string; currency: string },
): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  for (const p of points) {
    const price = p[priceKey(id)] as number | null | undefined;
    if (price == null) continue;
    out.push({
      ...meta,
      timestamp: p.timestamp,
      observedAt: p.observedAt,
      price,
      available: Boolean(p[availKey(id)]),
      type: p.type,
    });
  }
  return out;
}

/**
 * How much larger than a series' own typical observation gap counts as
 * "too large to bridge" (issue #29, bug 2). Chosen as a multiple of that
 * series' own median gap — not a fixed time span, and not the combined
 * chart's cadence — because how often *this* series itself is actually
 * observed is the only basis for calling one of its own gaps anomalous
 * rather than normal spacing.
 */
const GAP_BREAK_MULTIPLIER = 5;

/**
 * Splits one series' own real observations (time-sorted) into runs that
 * should each be drawn as one connected line. Consecutive observations
 * join into the same run — connecting through the combined chart's
 * nulls, which just mean "no other series changed here", not "no data"
 * for this series — *unless* the gap between them is unusually large
 * relative to this series' own typical cadence, in which case a new run
 * starts: bridging that stretch would draw a flat line implying a price
 * held steady through a period this series was never actually observed.
 * With fewer than 3 points there's no basis for "typical", so everything
 * in a single run of 1-2 points stays connected.
 */
function splitConnectedRuns(seriesPoints: SeriesPoint[]): SeriesPoint[][] {
  if (seriesPoints.length <= 2) {
    return seriesPoints.length > 0 ? [seriesPoints] : [];
  }
  const gaps = seriesPoints.slice(1).map((p, i) => p.timestamp - seriesPoints[i].timestamp);
  const sortedGaps = [...gaps].sort((a, b) => a - b);
  const medianGap = sortedGaps[Math.floor(sortedGaps.length / 2)];
  const threshold = medianGap * GAP_BREAK_MULTIPLIER;

  const runs: SeriesPoint[][] = [[seriesPoints[0]]];
  gaps.forEach((gap, i) => {
    if (medianGap > 0 && gap > threshold) {
      runs.push([seriesPoints[i + 1]]);
    } else {
      runs[runs.length - 1].push(seriesPoints[i + 1]);
    }
  });
  return runs;
}

/**
 * Filled dot in the series' color when in stock; hollow (background
 * fill, colored ring) when out of stock — so availability reads from
 * shape, not just color, per series (issue #17, extended to per-Store
 * series by issue #23). Each `<Line>` now plots only its own run of real
 * `SeriesPoint`s (issue #29), so there is no "absent here" case left to
 * handle — every point passed in has a real price.
 */
function SeriesDot(props: DotProps & { payload?: SeriesPoint; color: string }) {
  const { cx, cy, payload, color } = props;
  if (cx == null || cy == null || !payload) return null;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={4}
      fill={payload.available ? color : 'var(--color-background, #fff)'}
      stroke={color}
      strokeWidth={payload.available ? 1.5 : 2}
    />
  );
}

interface HoverState {
  point: SeriesPoint;
  left: number;
  top: number;
}

/**
 * Finds the real data point genuinely nearest the mouse — in both price
 * (vertical) and time (horizontal) — rather than Recharts' default
 * nearest-x-index behavior, which (issue #29, bug 3) surfaced whichever
 * series happened to have a value at the nearest shared timestamp,
 * regardless of how far away that value actually was on screen. With
 * each series populated at only a handful of the full combined x-axis's
 * timestamps, nearest-x-index routinely landed on the wrong series.
 *
 * Distance is computed in the plot's own normalized [0,1] x [0,1] space
 * (fraction of the full time range / full price range), not raw units,
 * so time (spanning days of milliseconds) and price (spanning single
 * dollars) contribute comparably to "nearest" instead of time dominating.
 *
 * The plot's pixel rectangle is read straight from Recharts' own
 * `.recharts-cartesian-grid-bg` background rect at move-time via the DOM,
 * rather than recomputed from margins/axis widths — that rect is exactly
 * the chart's actual plotting area in every Recharts version, so this
 * stays correct even if those layout numbers change.
 */
function useNearestPointHover(points: SeriesPoint[]) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<HoverState | null>(null);

  const domain = useMemo(() => {
    if (points.length === 0) return null;
    let minT = Infinity;
    let maxT = -Infinity;
    let minP = Infinity;
    let maxP = -Infinity;
    for (const p of points) {
      if (p.timestamp < minT) minT = p.timestamp;
      if (p.timestamp > maxT) maxT = p.timestamp;
      if (p.price < minP) minP = p.price;
      if (p.price > maxP) maxP = p.price;
    }
    // Small symmetric padding, roughly mirroring Recharts' own 'auto' Y
    // domain padding, so points at the exact min/max price aren't glued
    // to the plot's edge when computing normalized distance.
    const pad = (maxP - minP) * 0.1 || Math.max(maxP, 1) * 0.1;
    return { minT, maxT: maxT === minT ? maxT + 1 : maxT, minP: minP - pad, maxP: maxP + pad };
  }, [points]);

  const handleMove = (e: ReactMouseEvent<HTMLDivElement>) => {
    const container = containerRef.current;
    if (!container || !domain || points.length === 0) return;
    const gridBg = container.querySelector('.recharts-cartesian-grid-bg');
    if (!gridBg) return;
    const plotBox = gridBg.getBoundingClientRect();
    const containerBox = container.getBoundingClientRect();
    if (plotBox.width === 0 || plotBox.height === 0) return;

    const fracX = Math.min(1, Math.max(0, (e.clientX - plotBox.left) / plotBox.width));
    const fracY = Math.min(1, Math.max(0, (e.clientY - plotBox.top) / plotBox.height));
    const { minT, maxT, minP, maxP } = domain;

    let best: SeriesPoint | null = null;
    let bestDist = Infinity;
    for (const p of points) {
      const px = (p.timestamp - minT) / (maxT - minT);
      const py = 1 - (p.price - minP) / (maxP - minP);
      const dist = (px - fracX) ** 2 + (py - fracY) ** 2;
      if (dist < bestDist) {
        bestDist = dist;
        best = p;
      }
    }
    if (!best) return;

    const bestPx = (best.timestamp - minT) / (maxT - minT);
    const bestPy = 1 - (best.price - minP) / (maxP - minP);
    setHover({
      point: best,
      left: plotBox.left - containerBox.left + bestPx * plotBox.width,
      top: plotBox.top - containerBox.top + bestPy * plotBox.height,
    });
  };

  return { containerRef, hover, handleMove, handleLeave: () => setHover(null) };
}

/**
 * Floating tooltip + highlight ring for whatever point
 * `useNearestPointHover` found nearest the cursor. Positioned in pixels
 * relative to the hover container (not Recharts' own Tooltip, which this
 * replaces for the multi-series charts — see `useNearestPointHover`).
 * Flips below the point instead of above when too close to the chart's
 * top edge, so it is never clipped off the top of the card.
 */
function PointHoverOverlay({ hover }: { hover: HoverState }) {
  const { point, left, top } = hover;
  const flipBelow = top < 56;
  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      <span
        className="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-offset-1 ring-offset-background"
        style={{ left, top, backgroundColor: point.color, boxShadow: `0 0 0 2px ${point.color}` }}
      />
      <div
        className={`absolute -translate-x-1/2 rounded-md border bg-popover px-3 py-2 text-sm shadow-md ${
          flipBelow ? 'translate-y-3' : '-translate-y-[calc(100%+12px)]'
        }`}
        style={{ left, top }}
      >
        <p className="mb-0.5 font-medium">{formatDateTime(point.observedAt)}</p>
        <p className="flex items-center gap-1.5">
          <span
            className="inline-block size-2 shrink-0 rounded-full"
            style={{ backgroundColor: point.color }}
          />
          <span className="text-muted-foreground">{point.label}:</span>
          <span className="font-medium">{formatPrice(point.price, point.currency)}</span>
        </p>
        <p className={point.available ? 'text-xs text-emerald-600' : 'text-xs text-red-500'}>
          {point.available ? 'In stock' : 'Out of stock'}
        </p>
      </div>
    </div>
  );
}

/**
 * Renders the distinct-colored per-variant lines, legend, and
 * availability-by-shape chart for a Listing with more than one variant
 * (issue #17). Only reached when a Canonical Fish has exactly one Listing
 * (see dispatch in `PriceHistoryChart` below) — unchanged by issue #23.
 */
function MultiVariantPriceHistoryChart({
  events,
  currency,
}: {
  events: HistoryEvent[];
  currency: string;
}) {
  const { variants, points } = buildVariantSeries(events);
  const colors = variants.map((_, idx) => seriesColor(idx));

  // Per-series real-observation runs (issue #29, bug 2) — each `<Line>`
  // below plots one run, so a run's own points draw a connected line while
  // a gap too large for that series' own cadence starts a new, separately
  // drawn run instead of a misleading straight line across it.
  const runsByVariant = variants.map((v, idx) =>
    splitConnectedRuns(
      extractSeriesPoints(points, v.id, {
        key: v.id,
        label: v.label,
        color: colors[idx],
        currency,
      }),
    ),
  );
  const flatPoints = runsByVariant.flat(2);
  const { containerRef, hover, handleMove, handleLeave } = useNearestPointHover(flatPoints);

  return (
    <div className="w-full">
      <div
        ref={containerRef}
        className="relative h-72 w-full"
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
            {/* `fill="transparent"` (invisible — Recharts' default is `fill="none"`,
                which renders no background rect at all) forces Recharts to render
                its `.recharts-cartesian-grid-bg` rect, which `useNearestPointHover`
                reads via the DOM to know the plot area's exact pixel bounds. */}
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" fill="transparent" />
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
              tickFormatter={(p: number) => formatPrice(p, currency)}
              width={80}
              domain={['auto', 'auto']}
              className="text-xs"
            />
            {variants.map((v, idx) => {
              const color = colors[idx];
              return runsByVariant[idx].map((run, runIdx) => (
                <Line
                  key={`${v.id}-${runIdx}`}
                  data={run}
                  type="stepAfter"
                  dataKey="price"
                  name={v.label}
                  stroke={color}
                  strokeWidth={2}
                  dot={<SeriesDot color={color} />}
                  activeDot={false}
                  isAnimationActive={false}
                />
              ));
            })}
          </LineChart>
        </ResponsiveContainer>
        {hover && <PointHoverOverlay hover={hover} />}
      </div>
      <div className="mt-2 space-y-1 text-xs text-muted-foreground">
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {variants.map((v, idx) => (
            <span key={v.id} className="inline-flex items-center gap-1.5">
              <span
                className="inline-block size-2.5 rounded-full"
                style={{ backgroundColor: colors[idx] }}
              />
              {v.label}
            </span>
          ))}
        </div>
        <p className="inline-flex items-center gap-1.5">
          <span className="inline-block size-2 rounded-full border-2 border-current" /> Hollow
          marker = out of stock at that point. A variant with no line/price shown was priced
          $0.00 (sold out, not a real price).
        </p>
      </div>
    </div>
  );
}

/**
 * One Store's Listing, as the unified chart (issue #23) needs to know it:
 * which Store it belongs to (for hue), its own currency (a Store's price
 * line is always formatted in its own currency, never coerced to another
 * Store's), and its display name for the legend.
 */
export interface ChartListing {
  listingId: string;
  storeSlug: string;
  storeName: string;
  commonName: string;
  currency: string;
}

interface UnifiedSeriesMeta {
  key: string;
  storeSlug: string;
  color: string;
  dash: string | undefined;
  label: string;
  currency: string;
}

/**
 * Builds one line per (Listing, variant) pair across every Store carrying
 * this Canonical Fish, colored by Store (fixed hue, first-seen order across
 * `listings`) and, within a Store, distinguished by dash pattern
 * (first-seen order of that Store's own series) — see the dataviz-skill
 * rationale on `SERIES_COLOR_VARS`/`DASH_PATTERNS` above for why hue is the
 * Store-level identity channel and dash is the secondary, within-Store one.
 *
 * A Store can contribute more than one series in two real shapes seen on
 * the live `data` branch: a single Listing with multiple variants (#17's
 * case, e.g. Shrimpy Business's "3/6/12/24 Fish" on
 * `cf:sci:danio-margaritatus-aka`), or multiple distinct Listings from the
 * very same Store matched onto one Canonical Fish (e.g. AquaHuna carries
 * both a "Size Small" and a "Size Large" Listing for that same fish) — both
 * are handled by keying each series on `${listingId}::${variantId}` rather
 * than assuming one Listing per Store.
 */
function buildUnifiedSeries(
  events: HistoryEvent[],
  listings: ChartListing[],
): { series: UnifiedSeriesMeta[]; points: MultiVariantPoint[] } {
  const sorted = [...events].sort(
    (a, b) => new Date(a.observedAt).getTime() - new Date(b.observedAt).getTime(),
  );
  const listingBydId = new Map(listings.map((l) => [l.listingId, l]));

  // Store order + the Listings each Store contributes, both in first-seen
  // order of the `listings` input (not event order, and never price rank).
  const storeOrder: string[] = [];
  const listingIdsByStore = new Map<string, string[]>();
  for (const l of listings) {
    if (!listingIdsByStore.has(l.storeSlug)) {
      listingIdsByStore.set(l.storeSlug, []);
      storeOrder.push(l.storeSlug);
    }
    const ids = listingIdsByStore.get(l.storeSlug)!;
    if (!ids.includes(l.listingId)) ids.push(l.listingId);
  }
  const storeColor = new Map(storeOrder.map((slug, idx) => [slug, seriesColor(idx)]));

  // Variants per Listing, first-seen order across the sorted events.
  const variantsByListing = new Map<string, VariantMeta[]>();
  const seenVariant = new Set<string>();
  for (const e of sorted) {
    for (const v of e.variants ?? []) {
      const seenKey = `${e.listingId}::${v.id}`;
      if (seenVariant.has(seenKey)) continue;
      seenVariant.add(seenKey);
      const arr = variantsByListing.get(e.listingId) ?? [];
      arr.push({ id: v.id, label: v.label });
      variantsByListing.set(e.listingId, arr);
    }
  }

  const series: UnifiedSeriesMeta[] = [];
  for (const storeSlug of storeOrder) {
    const listingIds = listingIdsByStore.get(storeSlug) ?? [];
    const subSeriesCount = listingIds.reduce(
      (sum, id) => sum + (variantsByListing.get(id)?.length ?? 0),
      0,
    );
    let dashIdx = 0;
    for (const listingId of listingIds) {
      const listing = listingBydId.get(listingId);
      if (!listing) continue;
      const variants = variantsByListing.get(listingId) ?? [];
      const listingHasMultipleVariants = variants.length > 1;
      const storeHasMultipleListings = listingIds.length > 1;
      for (const v of variants) {
        // Single series for this Store overall -> plain Store name, exactly
        // like today's single-Store chart (no empty/confusing legend text).
        // Otherwise name the discriminator by whichever axis actually
        // varies for this series: the variant label when this Listing has
        // more than one variant, else the Listing's own name when it's the
        // Store itself carrying more than one Listing.
        const label =
          subSeriesCount === 1
            ? listing.storeName
            : `${listing.storeName} — ${
                listingHasMultipleVariants
                  ? v.label
                  : storeHasMultipleListings
                    ? listing.commonName
                    : v.label
              }`;
        series.push({
          key: `${listingId}::${v.id}`,
          storeSlug,
          color: storeColor.get(storeSlug)!,
          dash: dashPattern(dashIdx),
          label,
          currency: listing.currency,
        });
        dashIdx += 1;
      }
    }
  }

  // One row per event — a Store's own series are filled in; every other
  // Store's keys are left unset (not `null`) on that row, since a given
  // event only ever reflects its own Listing's scrape, not a snapshot of
  // every Store at once. `null` is reserved for this row's own $0.00
  // sold-out-placeholder case, consistent with the single-Listing path.
  const points: MultiVariantPoint[] = sorted.map((e) => {
    const point: MultiVariantPoint = {
      observedAt: e.observedAt,
      timestamp: new Date(e.observedAt).getTime(),
      type: e.type,
    };
    for (const v of e.variants ?? []) {
      const key = `${e.listingId}::${v.id}`;
      point[priceKey(key)] = v.price === 0 ? null : v.price;
      point[availKey(key)] = v.available;
    }
    return point;
  });

  return { series, points };
}

/**
 * Renders ONE price/availability chart across every Store carrying a
 * Canonical Fish (issue #23) — hue identifies the Store, dash pattern
 * identifies a series within a Store (its own variants, or a second
 * Listing the same Store carries), and marker shape (filled/hollow) still
 * carries availability, consistent with #17's treatment. Only reached when
 * a Canonical Fish has more than one Listing; see dispatch below.
 */
function UnifiedPriceHistoryChart({
  events,
  listings,
}: {
  events: HistoryEvent[];
  listings: ChartListing[];
}) {
  const { series, points } = buildUnifiedSeries(events, listings);
  const currencies = new Set(listings.map((l) => l.currency));
  // The Y axis is one shared scale across every Store's price line; when
  // Stores price in different currencies, format ticks in the first
  // Store's currency as a best-effort axis label and point readers to the
  // tooltip (always formatted per-series, in that series' own currency)
  // for the exact figure.
  const axisCurrency = listings[0]?.currency ?? 'USD';

  // Per-series real-observation runs (issue #29, bug 2) — see
  // `MultiVariantPriceHistoryChart` above for the same treatment.
  const runsBySeries = series.map((s) =>
    splitConnectedRuns(
      extractSeriesPoints(points, s.key, {
        key: s.key,
        label: s.label,
        color: s.color,
        currency: s.currency,
      }),
    ),
  );
  const flatPoints = runsBySeries.flat(2);
  const { containerRef, hover, handleMove, handleLeave } = useNearestPointHover(flatPoints);

  return (
    <div className="w-full">
      <div
        ref={containerRef}
        className="relative h-72 w-full"
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
            {/* `fill="transparent"` (invisible — Recharts' default is `fill="none"`,
                which renders no background rect at all) forces Recharts to render
                its `.recharts-cartesian-grid-bg` rect, which `useNearestPointHover`
                reads via the DOM to know the plot area's exact pixel bounds. */}
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" fill="transparent" />
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
              tickFormatter={(p: number) => formatPrice(p, axisCurrency)}
              width={80}
              domain={['auto', 'auto']}
              className="text-xs"
            />
            {series.map((s, idx) =>
              runsBySeries[idx].map((run, runIdx) => (
                <Line
                  key={`${s.key}-${runIdx}`}
                  data={run}
                  type="stepAfter"
                  dataKey="price"
                  name={s.label}
                  stroke={s.color}
                  strokeDasharray={s.dash}
                  strokeWidth={2}
                  dot={<SeriesDot color={s.color} />}
                  activeDot={false}
                  isAnimationActive={false}
                />
              )),
            )}
          </LineChart>
        </ResponsiveContainer>
        {hover && <PointHoverOverlay hover={hover} />}
      </div>
      <div className="mt-2 space-y-1 text-xs text-muted-foreground">
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {series.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5">
              <svg width="18" height="8" className="shrink-0" aria-hidden="true">
                <line
                  x1="0"
                  y1="4"
                  x2="18"
                  y2="4"
                  stroke={s.color}
                  strokeWidth="2"
                  strokeDasharray={s.dash}
                />
              </svg>
              {s.label}
            </span>
          ))}
        </div>
        <p className="inline-flex items-center gap-1.5">
          <span className="inline-block size-2 rounded-full border-2 border-current" /> Hollow
          marker = out of stock at that point. A gap in a line means that Store/variant was
          priced $0.00 (sold out, not a real price) or simply wasn't observed at that time.
        </p>
        {currencies.size > 1 && (
          <p>
            Stores shown price in different currencies — the axis is approximate; hover a
            point for the exact price and currency per Store.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Renders a Canonical Fish's historical price/availability chart from its
 * history events — one unified chart across every Store carrying it
 * (issue #23), building on #17's per-variant color-coding. `listings` must
 * contain exactly the Listings whose events appear in `events` (the
 * Listings a Canonical Fish currently has, from the index).
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
  // multi-series chart (issue #23). Exactly one Listing — the common
  // case — falls through unchanged to #17's per-variant chart or the
  // original single-line chart below: no regression, no empty/confusing
  // legend.
  const distinctListingIds = new Set(listings.map((l) => l.listingId));
  if (distinctListingIds.size > 1) {
    return <UnifiedPriceHistoryChart events={events} listings={listings} />;
  }

  const distinctVariantIds = new Set<string>();
  for (const e of events) {
    for (const v of e.variants ?? []) distinctVariantIds.add(v.id);
  }
  if (distinctVariantIds.size > 1) {
    return <MultiVariantPriceHistoryChart events={events} currency={currency} />;
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
