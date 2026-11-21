import { useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, RefObject } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
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
}

/** Per-Store display identity a bar needs: legend/tooltip label, fill color, currency. */
interface StoreMeta {
  label: string;
  color: string;
  currency: string;
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

/** A bar's pixel geometry: horizontal center, vertical span (min-enforced), and the average tick's y. */
interface BarGeometry {
  cx: number;
  yTop: number;
  yBottom: number;
  avgY: number;
}

const BAR_WIDTH = 10;
/**
 * Minimum rendered bar height in pixels — enforced so a Store with only one
 * variant at a given timestamp (min = max = average) still renders as a
 * visible, simple pill rather than a invisible sliver (issue #35's
 * degenerate-bar acceptance criterion).
 */
const MIN_BAR_HEIGHT_PX = 6;

function barGeometry(rect: PlotRect, domain: Domain, bar: StoreBar): BarGeometry {
  const cx = rect.left + ((bar.timestamp - domain.minT) / (domain.maxT - domain.minT)) * rect.width;
  const priceToY = (price: number) =>
    rect.top + (1 - (price - domain.minP) / (domain.maxP - domain.minP)) * rect.height;
  let yTop = priceToY(bar.max);
  let yBottom = priceToY(bar.min);
  if (yBottom - yTop < MIN_BAR_HEIGHT_PX) {
    const center = (yTop + yBottom) / 2;
    yTop = center - MIN_BAR_HEIGHT_PX / 2;
    yBottom = center + MIN_BAR_HEIGHT_PX / 2;
  }
  const avgY = Math.min(yBottom, Math.max(yTop, priceToY(bar.avg)));
  return { cx, yTop, yBottom, avgY };
}

/**
 * Draws every Store's range bars as an absolutely-positioned SVG overlay on
 * top of Recharts' axes/grid (see `usePlotRect` for why bars aren't plotted
 * through Recharts' own `<Bar>`: full control over the floating min-max
 * span, the enforced minimum height, and the average tick notch, mirroring
 * this file's existing precedent of overlaying custom marks on the
 * Recharts-drawn axes — see `PointHoverOverlay`'s predecessor). The average
 * tick is drawn in the chart surface color cut through the fill (the
 * dataviz skill's "surface gap" mechanism) rather than an added stroke, so
 * it reads in both light and dark without a second ink.
 */
function BarsOverlay({
  bars,
  rect,
  domain,
  hoveredKey,
}: {
  bars: StoreBar[];
  rect: PlotRect;
  domain: Domain;
  hoveredKey?: string;
}) {
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
      {bars.map((bar) => {
        const geo = barGeometry(rect, domain, bar);
        const isHovered = bar.key === hoveredKey;
        return (
          <g key={bar.key}>
            <rect
              x={geo.cx - BAR_WIDTH / 2}
              y={geo.yTop}
              width={BAR_WIDTH}
              height={geo.yBottom - geo.yTop}
              rx={BAR_WIDTH / 2}
              fill={bar.color}
              opacity={isHovered ? 1 : 0.85}
            />
            <rect
              x={geo.cx - BAR_WIDTH / 2 - 1}
              y={geo.avgY - 1}
              width={BAR_WIDTH + 2}
              height={2}
              fill="var(--color-background, #fff)"
            />
            {isHovered && (
              <rect
                x={geo.cx - BAR_WIDTH / 2 - 2}
                y={geo.yTop - 2}
                width={BAR_WIDTH + 4}
                height={geo.yBottom - geo.yTop + 4}
                rx={BAR_WIDTH / 2 + 2}
                fill="none"
                stroke={bar.color}
                strokeWidth={2}
              />
            )}
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
function useNearestBarHover(
  bars: StoreBar[],
  containerRef: RefObject<HTMLDivElement | null>,
  rect: PlotRect | null,
  domain: Domain | null,
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
      const geo = barGeometry(rect, domain, bar);
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
    if (!bestBar || !bestGeo) return;
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
 * the time. Omits the per-variant list entirely for a degenerate
 * single-variant bar, where it would just repeat the average/min/max line.
 */
function BarHoverOverlay({ hover }: { hover: BarHoverState }) {
  const { bar, left, top } = hover;
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
          <span
            className="inline-block size-2.5 shrink-0 rounded-[2px]"
            style={{ backgroundColor: bar.color }}
          />
          {bar.label}
        </p>
        <p className="text-xs text-muted-foreground">{formatDateTime(bar.observedAt)}</p>
        <p className="mt-1">
          <span className="font-medium">{formatPrice(bar.avg, bar.currency)}</span>{' '}
          <span className="text-xs text-muted-foreground">average</span>
        </p>
        <p className="text-xs text-muted-foreground">
          {formatPrice(bar.min, bar.currency)} – {formatPrice(bar.max, bar.currency)} range
        </p>
        {bar.variants.length > 1 && (
          <ul className="mt-1.5 space-y-0.5 border-t pt-1.5 text-xs">
            {bar.variants.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-3">
                <span className={v.available ? 'text-muted-foreground' : 'text-muted-foreground line-through'}>
                  {v.label}
                </span>
                <span className="font-medium">{formatPrice(v.price, bar.currency)}</span>
              </li>
            ))}
          </ul>
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
  const { hover, handleMove, handleLeave } = useNearestBarHover(bars, containerRef, rect, domain);

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
      {rect && domain && <BarsOverlay bars={bars} rect={rect} domain={domain} hoveredKey={hover?.bar.key} />}
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
      new Map([[listing.storeSlug, { label: listing.storeName, color: seriesColor(0), currency: listing.currency }]]),
    [listing.storeSlug, listing.storeName, listing.currency],
  );
  const bars = useMemo(() => computeStoreBars(events, storeMeta), [events, storeMeta]);

  return (
    <div className="w-full">
      <RangeBarChart bars={bars} axisCurrency={listing.currency} />
      <p className="mt-2 text-xs text-muted-foreground">
        Each bar spans {listing.storeName}&apos;s lowest to highest priced variant at that time;
        the pale notch marks the average. Hover a bar for every variant&apos;s own price — a
        struck-through variant was out of stock at that time. A variant priced $0.00 is treated
        as sold out, not a real price, and is left out of the bar.
      </p>
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
      meta.set(l.storeSlug, { label: l.storeName, color: seriesColor(idx), currency: l.currency });
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
        <p>
          Each bar spans a Store&apos;s lowest to highest priced variant at that time; the pale
          notch marks the average. Hover a bar for every variant&apos;s own price — a
          struck-through variant was out of stock at that time.
        </p>
        {currencies.size > 1 && (
          <p>
            Stores shown price in different currencies — the axis is approximate; hover a bar
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
