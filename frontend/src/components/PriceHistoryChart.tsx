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
 * Fixed-order categorical palette for per-variant lines (issue #17).
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
 * Assigns a variant its color by stable slot index (first-seen order across
 * the history, never by current price rank), so a variant keeps its color
 * as other variants come and go in the underlying data, and so the same
 * variant id never repaints when a sibling variant disappears. Past the 8
 * validated hues (an edge case for "size/grade" variants — not the common
 * case) colors cycle rather than inventing an ungoverned 9th hue; the
 * legend's text label remains the authoritative way to tell those apart.
 */
function seriesColor(index: number): string {
  return SERIES_COLOR_VARS[index % SERIES_COLOR_VARS.length];
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

function priceKey(variantId: string): string {
  return `price__${variantId}`;
}

function availKey(variantId: string): string {
  return `avail__${variantId}`;
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
 * Filled dot in the variant's color when in stock; hollow (background
 * fill, colored ring) when out of stock — so availability reads from
 * shape, not just color, per variant (issue #17). No dot is drawn where
 * there is no price to plot (variant absent from that event, or a
 * $0.00 sold-out placeholder).
 */
function VariantDot(
  props: DotProps & { payload?: MultiVariantPoint; variantId: string; color: string },
) {
  const { cx, cy, payload, variantId, color } = props;
  if (cx == null || cy == null || !payload) return null;
  const price = payload[priceKey(variantId)];
  if (price == null) return null;
  const available = Boolean(payload[availKey(variantId)]);
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
 * (issue #17).
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
                dot={<VariantDot variantId={v.id} color={color} />}
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

/** Renders a per-fish historical price/availability chart from its history events. */
export function PriceHistoryChart({
  events,
  currency,
}: {
  events: HistoryEvent[];
  currency: string;
}) {
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

  // A Listing whose history carries more than one distinct variant id gets
  // its own per-variant colored-line chart (issue #17). A single-variant
  // Listing — the common case — falls through to the original, unchanged
  // single-line chart below: no regression, no empty/confusing legend.
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
