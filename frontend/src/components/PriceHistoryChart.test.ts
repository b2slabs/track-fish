import { describe, expect, it } from 'vitest';
import { buildSingleObservationMessage } from './PriceHistoryChart';
import { singlePointStubPath } from './price-history-chart-geometry';
import type { HistoryEvent } from '@/types/data';
import type { ChartListing } from './PriceHistoryChart';

// Issue #89: a run with exactly one point must render using the same
// "line-style marker" visual language as a multi-point run's connected
// step-line (color, dash pattern, stroke width) rather than a lone dot with
// no line-like geometry at all. `singlePointStubPath` is the pure geometry
// behind that marker: a short horizontal stub centered on the point, drawn
// as an SVG path `d` string so it can share the exact same <path> stroke
// styling (color/dash/width) multi-point runs already use.
describe('singlePointStubPath', () => {
  it('centers a horizontal stub of the given half-width on the point', () => {
    const d = singlePointStubPath(100, 50, 8);
    expect(d).toBe('M 92 50 H 108');
  });

  it('defaults to a small, non-zero half-width when none is given', () => {
    const d = singlePointStubPath(100, 50);
    // Must not collapse to a zero-length path (an `M` with no draw command is
    // invisible — that's exactly the "renders as a dot, not a line" bug).
    expect(d).not.toBe('M 100 50');
    expect(d).toMatch(/^M -?\d+(\.\d+)? 50 H -?\d+(\.\d+)?$/);
  });
});

function makeEvent(overrides: Partial<HistoryEvent> = {}): HistoryEvent {
  return {
    type: 'change',
    observedAt: '2026-11-22T10:00:00.000Z',
    price: 12.99,
    currency: 'USD',
    available: true,
    variants: [],
    listingId: 'store:fish',
    storeSlug: 'store',
    ...overrides,
  };
}

function makeListing(overrides: Partial<ChartListing> = {}): ChartListing {
  return {
    listingId: 'store:fish',
    storeSlug: 'store',
    storeName: 'Store',
    commonName: 'Fish',
    currency: 'USD',
    lastCheckedAt: '2026-11-22T10:00:00.000Z',
    available: true,
    ...overrides,
  };
}

describe('buildSingleObservationMessage', () => {
  it('is unchanged for a genuinely brand-new fish (one observation, observed today, lastCheckedAt same instant)', () => {
    const event = makeEvent();
    const listing = makeListing();
    const message = buildSingleObservationMessage(event, listing, 'USD');
    expect(message).toBe(
      'Only one observation recorded so far (Nov 22, 2026, 10:00 AM): $12.99, in stock. Check back after more scrape runs for a trend.',
    );
  });

  it('reflects a later confirmed-observed date when the Listing has since been re-scraped and is still in stock (issue #88)', () => {
    const event = makeEvent({ observedAt: '2026-11-22T10:00:00.000Z', available: true });
    const listing = makeListing({ lastCheckedAt: '2026-11-24T15:00:00.000Z', available: true });
    const message = buildSingleObservationMessage(event, listing, 'USD');
    expect(message).toBe(
      "Only one price change recorded so far (Nov 22, 2026, 10:00 AM): $12.99. Still confirmed in stock as of the latest scrape on Nov 24, 2026, 3:00 PM. Check back after a price change for a trend.",
    );
  });

  it('does not claim still in stock if the fish has since gone out of stock (issue #88)', () => {
    const event = makeEvent({ observedAt: '2026-11-22T10:00:00.000Z', available: true });
    const listing = makeListing({ lastCheckedAt: '2026-11-24T15:00:00.000Z', available: false });
    const message = buildSingleObservationMessage(event, listing, 'USD');
    expect(message).not.toContain('in stock.');
    expect(message).not.toContain('Still confirmed in stock');
    expect(message).toBe(
      "Only one price change recorded so far (Nov 22, 2026, 10:00 AM): $12.99. It's since gone out of stock (last checked Nov 24, 2026, 3:00 PM). Check back after more scrape runs for a trend.",
    );
  });

  it('falls back to the original wording when no matching listing is found', () => {
    const event = makeEvent();
    const message = buildSingleObservationMessage(event, undefined, 'USD');
    expect(message).toBe(
      'Only one observation recorded so far (Nov 22, 2026, 10:00 AM): $12.99, in stock. Check back after more scrape runs for a trend.',
    );
  });
});
