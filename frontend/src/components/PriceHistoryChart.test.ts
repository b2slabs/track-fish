import { describe, expect, it } from 'vitest';
import { buildSingleObservationMessage } from './PriceHistoryChart';
import type { HistoryEvent } from '@/types/data';
import type { ChartListing } from './PriceHistoryChart';

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
