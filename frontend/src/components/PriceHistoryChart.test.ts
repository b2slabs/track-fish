import { describe, expect, it } from 'vitest';
import { buildSingleObservationMessage, computeVariantLines, type ChartListing, type StoreMeta } from './PriceHistoryChart';
import { singlePointStubPath } from './price-history-chart-geometry';
import type { HistoryEvent } from '@/types/data';

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

/**
 * Seam under test: `computeVariantLines` — the pure run-splitting function
 * behind the price-history chart's per-variant step-lines. Tested directly
 * (per issue #87) rather than through the full `PriceHistoryChart`
 * component, since every behavior in question (which points land in the
 * same run vs. a new one) is fully determined by this function's output.
 */

function storeMeta(slug: string): Map<string, StoreMeta> {
  return new Map([[slug, { label: slug, color: '#000', currency: 'USD', seriesIndex: 0 }]]);
}

function variantEvent(
  observedAt: string,
  variants: { id: string; price: number; available: boolean; label?: string }[],
  overrides: Partial<HistoryEvent> = {},
): HistoryEvent {
  return {
    type: 'change',
    observedAt,
    price: variants[0]?.price ?? 0,
    currency: 'USD',
    available: variants[0]?.available ?? false,
    variants: variants.map((v) => ({ id: v.id, label: v.label ?? 'Default', price: v.price, available: v.available })),
    listingId: 'listing-1',
    storeSlug: 'ck-fish-world',
    ...overrides,
  };
}

describe('computeVariantLines — same-price run splitting (issue #87)', () => {
  it('bridges a silent gap with no out-of-stock evidence into one run (baseline, issue #75)', () => {
    const events = [
      variantEvent('2026-01-08T00:00:00Z', [{ id: 'v1', price: 59.98, available: true }]),
      variantEvent('2026-11-24T00:00:00Z', [{ id: 'v1', price: 59.98, available: true }]),
    ];
    const [line] = computeVariantLines(events, storeMeta('ck-fish-world'), new Map());
    expect(line.runs).toHaveLength(1);
    expect(line.runs[0]).toHaveLength(2);
  });

  it('does not break the line when a same-price point follows an out-of-stock gap (CK Fish World / Panda Cory, issue #87)', () => {
    const events = [
      variantEvent('2026-01-08T00:00:00Z', [{ id: 'v1', price: 59.98, available: true }]),
      // Hard evidence of a gap in between (explicit out-of-stock reading).
      variantEvent('2026-06-01T00:00:00Z', [{ id: 'v1', price: 59.98, available: false }]),
      // Resumes at the exact same price as before the gap.
      variantEvent('2026-11-20T00:00:00Z', [{ id: 'v1', price: 59.98, available: true }]),
      variantEvent('2026-11-24T00:00:00Z', [{ id: 'v1', price: 59.98, available: true }]),
    ];
    const [line] = computeVariantLines(events, storeMeta('ck-fish-world'), new Map());
    expect(line.runs).toHaveLength(1);
    expect(line.runs[0].map((p) => p.price)).toEqual([59.98, 59.98, 59.98]);
  });

  it('still breaks the line on a genuine out-of-stock gap that resumes at a different price', () => {
    const events = [
      variantEvent('2026-01-08T00:00:00Z', [{ id: 'v1', price: 59.98, available: true }]),
      variantEvent('2026-06-01T00:00:00Z', [{ id: 'v1', price: 59.98, available: false }]),
      // Resumes at a genuinely different price — a real, meaningful change.
      variantEvent('2026-11-20T00:00:00Z', [{ id: 'v1', price: 64.99, available: true }]),
    ];
    const [line] = computeVariantLines(events, storeMeta('ck-fish-world'), new Map());
    expect(line.runs).toHaveLength(2);
    expect(line.runs[0].map((p) => p.price)).toEqual([59.98]);
    expect(line.runs[1].map((p) => p.price)).toEqual([64.99]);
  });

  it('still breaks the line when a variant is removed and a different variant later reappears at a different price', () => {
    const events = [
      variantEvent('2026-01-08T00:00:00Z', [{ id: 'v1', price: 59.98, available: true }]),
      // v1 entirely absent from this later event — hard evidence of removal.
      variantEvent('2026-06-01T00:00:00Z', [{ id: 'v2', price: 10, available: true }]),
      variantEvent('2026-11-20T00:00:00Z', [
        { id: 'v1', price: 70, available: true },
        { id: 'v2', price: 10, available: true },
      ]),
    ];
    const [v1Line] = computeVariantLines(events, storeMeta('ck-fish-world'), new Map()).filter((l) =>
      l.key.endsWith('::v1'),
    );
    expect(v1Line.runs).toHaveLength(2);
  });
});
