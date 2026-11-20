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

/** Renders a per-fish historical price/availability chart from its history events. */
export function PriceHistoryChart({
  events,
  currency,
}: {
  events: HistoryEvent[];
  currency: string;
}) {
  const points: ChartPoint[] = events
    .map((e) => ({
      observedAt: e.observedAt,
      timestamp: new Date(e.observedAt).getTime(),
      price: e.price,
      available: e.available,
      type: e.type,
    }))
    .sort((a, b) => a.timestamp - b.timestamp);

  if (points.length === 0) {
    return <p className="text-sm text-muted-foreground">No history recorded yet.</p>;
  }

  if (points.length === 1) {
    const only = points[0];
    return (
      <p className="text-sm text-muted-foreground">
        Only one observation recorded so far ({formatDateTime(only.observedAt)}):{' '}
        {formatPrice(only.price, currency)}, {only.available ? 'in stock' : 'out of stock'}.
        Check back after more scrape runs for a trend.
      </p>
    );
  }

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
