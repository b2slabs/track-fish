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
 * Filled dot in the series' color when in stock; hollow (background
 * fill, colored ring) when out of stock — so availability reads from
 * shape, not just color, per series (issue #17, extended to per-Store
 * series by issue #23). No dot is drawn where there is no price to plot
 * (series absent from that event, or a $0.00 sold-out placeholder).
 */
function SeriesDot(
  props: DotProps & { payload?: MultiVariantPoint; seriesKey: string; color: string },
) {
  const { cx, cy, payload, seriesKey, color } = props;
  if (cx == null || cy == null || !payload) return null;
  const price = payload[priceKey(seriesKey)];
  if (price == null) return null;
  const available = Boolean(payload[availKey(seriesKey)]);
  return (
    <circle
      cx={cx}
      cy={cy}
      r={4}
      fill={available ? color : 'var(--color-background, #fff)'}
      stroke={color}
      strokeWidth={available ? 1.5 : 2}
    />
  );
}

function MultiVariantTooltip({
  active,
  payload,
  variants,
  colors,
  currency,
}: {
  active?: boolean;
  payload?: Array<{ payload: MultiVariantPoint }>;
  variants: VariantMeta[];
  colors: string[];
  currency: string;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-sm shadow-md">
      <p className="mb-1 font-medium">{formatDateTime(point.observedAt)}</p>
      <ul className="space-y-0.5">
        {variants.map((v, idx) => {
          const price = point[priceKey(v.id)] as number | null;
          const available = Boolean(point[availKey(v.id)]);
          return (
            <li key={v.id} className="flex items-center gap-2">
              <span
                className="inline-block size-2 shrink-0 rounded-full"
                style={{ backgroundColor: colors[idx] }}
              />
              <span className="text-muted-foreground">{v.label}:</span>
              <span className="font-medium">
                {price == null ? 'Sold out (no price)' : formatPrice(price, currency)}
              </span>
              {price != null && !available && (
                <span className="text-xs text-red-500">out of stock</span>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-1 text-xs text-muted-foreground">
        {point.type === 'change' ? 'Change event' : 'Heartbeat'}
      </p>
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

  return (
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
            tickFormatter={(p: number) => formatPrice(p, currency)}
            width={80}
            domain={['auto', 'auto']}
            className="text-xs"
          />
          <Tooltip
            content={<MultiVariantTooltip variants={variants} colors={colors} currency={currency} />}
          />
          {variants.map((v, idx) => {
            const color = colors[idx];
            return (
              <Line
                key={v.id}
                type="stepAfter"
                dataKey={priceKey(v.id)}
                name={v.label}
                stroke={color}
                strokeWidth={2}
                dot={<SeriesDot seriesKey={v.id} color={color} />}
                activeDot={{ r: 6, fill: color, stroke: 'var(--background)' }}
                connectNulls={false}
                isAnimationActive={false}
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
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

function UnifiedTooltip({
  active,
  payload,
  series,
}: {
  active?: boolean;
  payload?: Array<{ payload: MultiVariantPoint }>;
  series: UnifiedSeriesMeta[];
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  // Only series actually observed at this exact timestamp carry a value on
  // this row (see `buildUnifiedSeries`) — every other Store's series is
  // `undefined` here, not `null`, and is left out rather than shown as a
  // false "sold out".
  const observed = series.filter((s) => point[priceKey(s.key)] !== undefined);
  if (observed.length === 0) return null;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-sm shadow-md">
      <p className="mb-1 font-medium">{formatDateTime(point.observedAt)}</p>
      <ul className="space-y-0.5">
        {observed.map((s) => {
          const price = point[priceKey(s.key)] as number | null;
          const available = Boolean(point[availKey(s.key)]);
          return (
            <li key={s.key} className="flex items-center gap-2">
              <span
                className="inline-block size-2 shrink-0 rounded-full"
                style={{ backgroundColor: s.color }}
              />
              <span className="text-muted-foreground">{s.label}:</span>
              <span className="font-medium">
                {price == null ? 'Sold out (no price)' : formatPrice(price, s.currency)}
              </span>
              {price != null && !available && (
                <span className="text-xs text-red-500">out of stock</span>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-1 text-xs text-muted-foreground">
        {point.type === 'change' ? 'Change event' : 'Heartbeat'}
      </p>
    </div>
  );
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

  return (
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
            tickFormatter={(p: number) => formatPrice(p, axisCurrency)}
            width={80}
            domain={['auto', 'auto']}
            className="text-xs"
          />
          <Tooltip content={<UnifiedTooltip series={series} />} />
          {series.map((s) => (
            <Line
              key={s.key}
              type="stepAfter"
              dataKey={priceKey(s.key)}
              name={s.label}
              stroke={s.color}
              strokeDasharray={s.dash}
              strokeWidth={2}
              dot={<SeriesDot seriesKey={s.key} color={s.color} />}
              activeDot={{ r: 6, fill: s.color, stroke: 'var(--background)' }}
              connectNulls={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
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
