import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  computeVariantLines,
  pointXY,
  PriceHistoryChart,
  type ChartListing,
  type Domain,
  type PlotRect,
  type StoreMeta,
  type VariantPoint,
} from './PriceHistoryChart';
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

/**
 * Seam under test: `PriceHistoryChart` itself, rendered with
 * `react-dom/server`'s `renderToStaticMarkup` — no extra test-rendering
 * dependency needed (`react-dom` is already a runtime dependency here), and
 * sufficient to assert the top-level text-vs-chart branching this issue is
 * about. Interactive behavior (hover, DOM measurement via `usePlotRect`)
 * isn't exercised this way since those run in `useEffect`, which
 * `renderToStaticMarkup` never invokes -- that's fine, this seam only needs
 * to confirm *which* branch rendered, not pixel-level chart behavior
 * (`computeVariantLines`'s own tests already cover that).
 */
describe('PriceHistoryChart — chart-vs-text branching (issue #126)', () => {
  it('still shows "No history recorded yet." for a fish with zero Change Events', () => {
    const html = renderToStaticMarkup(React.createElement(PriceHistoryChart, { events: [], listings: [] }));
    expect(html).toContain('No history recorded yet.');
  });

  it('renders the chart, not a text summary, for a fish with exactly one Change Event (issue #126)', () => {
    const event = makeEvent();
    const listing = makeListing();
    const html = renderToStaticMarkup(
      React.createElement(PriceHistoryChart, { events: [event], listings: [listing] }),
    );
    expect(html).not.toContain('Only one');
    expect(html).not.toContain('No history recorded yet.');
    // `StepLineChart`'s own hover container -- a stable marker that the
    // chart branch (not the text branch) rendered.
    expect(html).toContain('relative h-72 w-full');
  });

  it('still renders the chart for a fish with 2+ Change Events (existing behavior, unaffected)', () => {
    const events = [
      makeEvent({ observedAt: '2026-11-20T10:00:00.000Z', price: 12.99 }),
      makeEvent({ observedAt: '2026-11-22T10:00:00.000Z', price: 13.99 }),
    ];
    const listing = makeListing({ lastCheckedAt: '2026-11-22T10:00:00.000Z' });
    const html = renderToStaticMarkup(
      React.createElement(PriceHistoryChart, { events, listings: [listing] }),
    );
    expect(html).not.toContain('No history recorded yet.');
    expect(html).toContain('relative h-72 w-full');
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
  return new Map([[slug, { label: slug, color: '#000', currency: 'USD' }]]);
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
    // Still one unbroken run (no break) -- but no second point either, since
    // the price never actually changed (issue #123: an unchanged
    // reconfirmation isn't its own point).
    expect(line.runs[0]).toHaveLength(1);
  });

  it('splits into two runs with a gray outOfStockSegments connector between them when a same-price point follows a gap (CK Fish World / Panda Cory, issue #87/#111)', () => {
    const events = [
      variantEvent('2026-01-08T00:00:00Z', [{ id: 'v1', price: 59.98, available: true }]),
      // Hard evidence of a gap in between (explicit out-of-stock reading).
      variantEvent('2026-06-01T00:00:00Z', [{ id: 'v1', price: 59.98, available: false }]),
      // Resumes at the exact same price as before the gap.
      variantEvent('2026-11-20T00:00:00Z', [{ id: 'v1', price: 59.98, available: true }]),
      variantEvent('2026-11-24T00:00:00Z', [{ id: 'v1', price: 59.98, available: true }]),
    ];
    const [line] = computeVariantLines(events, storeMeta('ck-fish-world'), new Map());
    expect(line.runs).toHaveLength(2);
    expect(line.runs[0].map((p) => p.price)).toEqual([59.98]);
    // The resumption point is kept (gap resumption is unaffected by issue
    // #123), but the Nov 24 reconfirmation at the same price is not --
    // nothing about it is new information.
    expect(line.runs[1].map((p) => p.price)).toEqual([59.98]);
    expect(line.outOfStockSegments).toHaveLength(1);
    const [start, end] = line.outOfStockSegments[0];
    expect(start.key).toBe(line.runs[0][0].key);
    expect(end.key).toBe(line.runs[1][0].key);
  });

  it('still breaks the line on a genuine out-of-stock gap that resumes at a different price, with the same gray connector in between', () => {
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
    expect(line.outOfStockSegments).toHaveLength(1);
  });

  // Issue #111: Shrimpy Business's Celestial Pearl Danio listing toggles
  // `available` true/false every few days at an unchanged price — each
  // toggle is a real, distinct Change Event (not a duplicate-event bug).
  // Every one of these gaps gets its own gray connector, so a dense run of
  // same-price availability flaps reads as an alternating color/gray
  // pattern reflecting real history, not a silently-bridged solid line.
  it('gives every gap its own outOfStockSegments connector for a repeatedly-flapping variant (issue #111)', () => {
    const events = [
      variantEvent('2026-01-08T00:00:00Z', [{ id: 'v1', price: 22.5, available: true }]),
      variantEvent('2026-01-27T00:00:00Z', [{ id: 'v1', price: 22.5, available: false }]),
      variantEvent('2026-01-28T00:00:00Z', [{ id: 'v1', price: 22.5, available: true }]),
      variantEvent('2026-02-04T00:00:00Z', [{ id: 'v1', price: 22.5, available: false }]),
      variantEvent('2026-02-05T00:00:00Z', [{ id: 'v1', price: 22.5, available: true }]),
    ];
    const [line] = computeVariantLines(events, storeMeta('ck-fish-world'), new Map());
    expect(line.runs).toHaveLength(3);
    expect(line.outOfStockSegments).toHaveLength(2);
    expect(line.outOfStockSegments.map(([a, b]) => [a.price, b.price])).toEqual([
      [22.5, 22.5],
      [22.5, 22.5],
    ]);
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
    expect(v1Line.outOfStockSegments).toHaveLength(1);
  });
});

describe('pointXY — no same-day Store stagger (issue #94)', () => {
  const rect: PlotRect = { left: 0, top: 0, width: 1000, height: 100 };
  const domain: Domain = { minT: 0, maxT: 10 * 24 * 60 * 60 * 1000, minP: 0, maxP: 100 };

  function point(timestamp: number, price: number): VariantPoint {
    return { key: `${timestamp}-${price}`, timestamp, observedAt: new Date(timestamp).toISOString(), price };
  }

  it("places a point's x exactly at its true timestamp, never nudged aside", () => {
    const p = point(5 * 24 * 60 * 60 * 1000, 50);
    expect(pointXY(rect, domain, p).cx).toBe(rect.left + rect.width / 2);
  });

  it("renders two different Stores' same-day, same-price points at the identical pixel, not staggered apart", () => {
    const timestamp = 3 * 24 * 60 * 60 * 1000;
    const storeAPoint = point(timestamp, 40);
    const storeBPoint = point(timestamp, 40);

    expect(pointXY(rect, domain, storeAPoint)).toEqual(pointXY(rect, domain, storeBPoint));
  });
});

describe('computeVariantLines — trailing outOfStockSegments (issue #103)', () => {
  it('extends a currently out-of-stock variant with a trailing gray segment out to lastCheckedAt', () => {
    const events = [
      variantEvent('2026-11-20T00:00:00Z', [{ id: 'v1', price: 10, available: true }]),
      // Confirmed out of stock as of the latest scrape.
      variantEvent('2026-11-24T00:00:00Z', [{ id: 'v1', price: 10, available: false }]),
    ];
    const lastChecked = new Map([['listing-1', '2026-11-26T00:00:00Z']]);
    const [line] = computeVariantLines(events, storeMeta('ck-fish-world'), lastChecked);

    expect(line.runs).toHaveLength(1);
    expect(line.runs[0].map((p) => p.price)).toEqual([10]); // the gap isn't appended to the real run
    expect(line.outOfStockSegments).toHaveLength(1);
    const [start, end] = line.outOfStockSegments[0];
    expect(start.timestamp).toBe(new Date('2026-11-20T00:00:00Z').getTime());
    expect(end.timestamp).toBe(new Date('2026-11-26T00:00:00Z').getTime());
    expect(end.price).toBe(10); // flat at the last real price
    // Regression (user report, NU Aqua Shop / Gastrodermus hastatus): this
    // run has exactly one real point, so `LinesOverlay` would otherwise draw
    // issue #89's symmetric single-point stub centered on it AND the gray
    // segment's line starting from it, double-drawing a short line right on
    // top of the stub's own right half -- visually a stray line crossing
    // the point. The segment's start identifying the exact same point as
    // the lone point in `runs[0]` is what `LinesOverlay` keys off of to
    // skip the redundant stub in that case.
    expect(start.key).toBe(line.runs[0][0].key);
  });

  it('extends a delisted (vanished) variant with a trailing segment only to its frozen lastCheckedAt, not further', () => {
    const events = [
      variantEvent('2026-11-20T00:00:00Z', [{ id: 'v1', price: 10, available: true }]),
      // v1 entirely absent -- vanished from the catalog.
      variantEvent('2026-11-21T00:00:00Z', [{ id: 'v2', price: 5, available: true }]),
    ];
    // Per src/process.ts, a delisted Listing's lastCheckedAt freezes at its
    // last real observation -- it never advances past 2026-11-20 here.
    const lastChecked = new Map([['listing-1', '2026-11-20T00:00:00Z']]);
    const [v1Line] = computeVariantLines(events, storeMeta('ck-fish-world'), lastChecked).filter((l) =>
      l.key.endsWith('::v1'),
    );

    expect(v1Line.outOfStockSegments).toHaveLength(0); // nothing to extend: lastCheckedAt == last real point
  });

  it('does not add a trailing segment for a variant currently in stock (existing issue #81 extension applies instead)', () => {
    const events = [variantEvent('2026-11-20T00:00:00Z', [{ id: 'v1', price: 10, available: true }])];
    const lastChecked = new Map([['listing-1', '2026-11-26T00:00:00Z']]);
    const [line] = computeVariantLines(events, storeMeta('ck-fish-world'), lastChecked);

    expect(line.outOfStockSegments).toHaveLength(0);
    expect(line.runs[0]).toHaveLength(2); // the ordinary flat continuation
    expect(line.runs[0][1].price).toBe(10);
  });

  it('adds no trailing segment when lastCheckedAt is not later than the last real observation', () => {
    const events = [
      variantEvent('2026-11-20T00:00:00Z', [{ id: 'v1', price: 10, available: true }]),
      variantEvent('2026-11-24T00:00:00Z', [{ id: 'v1', price: 10, available: false }]),
    ];
    // Same instant as the last real (in-stock) observation -- nothing to extend.
    const lastChecked = new Map([['listing-1', '2026-11-20T00:00:00Z']]);
    const [line] = computeVariantLines(events, storeMeta('ck-fish-world'), lastChecked);

    expect(line.outOfStockSegments).toHaveLength(0);
  });
});

describe('computeVariantLines — lastCheckedAt extension respects current availability (issue #126)', () => {
  it('extends with a gray outOfStockSegment, not a colored continuation, when the Listing is now unavailable with no event-level gap evidence yet', () => {
    const events = [variantEvent('2026-11-20T00:00:00Z', [{ id: 'v1', price: 10, available: true }])];
    const lastChecked = new Map([['listing-1', '2026-11-26T00:00:00Z']]);
    const availableByListing = new Map([['listing-1', false]]);
    const [line] = computeVariantLines(events, storeMeta('ck-fish-world'), lastChecked, availableByListing);

    // The real point stays alone in its own run -- nothing colored added.
    expect(line.runs).toHaveLength(1);
    expect(line.runs[0]).toHaveLength(1);
    expect(line.outOfStockSegments).toHaveLength(1);
    const [start, end] = line.outOfStockSegments[0];
    expect(start.key).toBe(line.runs[0][0].key);
    expect(end.timestamp).toBe(new Date('2026-11-26T00:00:00Z').getTime());
    expect(end.price).toBe(10);
  });

  it('keeps the ordinary colored flat continuation when the Listing is still available (default, backward compatible)', () => {
    const events = [variantEvent('2026-11-20T00:00:00Z', [{ id: 'v1', price: 10, available: true }])];
    const lastChecked = new Map([['listing-1', '2026-11-26T00:00:00Z']]);
    const availableByListing = new Map([['listing-1', true]]);
    const [line] = computeVariantLines(events, storeMeta('ck-fish-world'), lastChecked, availableByListing);

    expect(line.runs[0]).toHaveLength(2);
    expect(line.outOfStockSegments).toHaveLength(0);
  });

  it('keeps the ordinary colored flat continuation when no availableByListing map is passed at all (existing callers unaffected)', () => {
    const events = [variantEvent('2026-11-20T00:00:00Z', [{ id: 'v1', price: 10, available: true }])];
    const lastChecked = new Map([['listing-1', '2026-11-26T00:00:00Z']]);
    const [line] = computeVariantLines(events, storeMeta('ck-fish-world'), lastChecked);

    expect(line.runs[0]).toHaveLength(2);
    expect(line.outOfStockSegments).toHaveLength(0);
  });
});

describe('computeVariantLines — confirmedSameUntil (issue #113)', () => {
  it('extends the colored run through confirmedSameUntil before the gray segment starts, instead of collapsing to the last real event', () => {
    const events = [
      variantEvent('2026-11-20T00:00:00Z', [{ id: 'v1', price: 10, available: true }]),
      // Monster Aquarium example: confirmed unchanged through Nov 26 (no
      // event written those days), then genuinely goes out of stock Nov 27.
      variantEvent('2026-11-27T00:00:00Z', [{ id: 'v1', price: 10, available: false }], {
        confirmedSameUntil: '2026-11-26T00:00:00Z',
      }),
    ];
    const lastChecked = new Map([['listing-1', '2026-11-27T00:00:00Z']]);
    const [line] = computeVariantLines(events, storeMeta('ck-fish-world'), lastChecked);

    expect(line.runs).toHaveLength(1);
    expect(line.runs[0].map((p) => ({ observedAt: p.observedAt, price: p.price }))).toEqual([
      { observedAt: '2026-11-20T00:00:00Z', price: 10 },
      { observedAt: '2026-11-26T00:00:00Z', price: 10 }, // synthetic, from confirmedSameUntil
    ]);
    // The gray segment starts at the confirmedSameUntil date, not the
    // original Nov 20 event -- that's the whole point.
    expect(line.outOfStockSegments).toHaveLength(1);
    const [start] = line.outOfStockSegments[0];
    expect(start.observedAt).toBe('2026-11-26T00:00:00Z');
  });

  it('ignores confirmedSameUntil when it is not later than the last real point (no intervening confirmed day)', () => {
    const events = [
      variantEvent('2026-11-20T00:00:00Z', [{ id: 'v1', price: 10, available: true }]),
      variantEvent('2026-11-21T00:00:00Z', [{ id: 'v1', price: 10, available: false }], {
        confirmedSameUntil: '2026-11-20T00:00:00Z', // same instant as the last real point
      }),
    ];
    const [line] = computeVariantLines(events, storeMeta('ck-fish-world'), new Map());

    expect(line.runs[0]).toHaveLength(1); // no synthetic point added
  });

  it('ignores confirmedSameUntil on a variant\'s very first event (nothing to extend)', () => {
    const events = [
      variantEvent('2026-11-20T00:00:00Z', [{ id: 'v1', price: 10, available: false }], {
        confirmedSameUntil: '2026-11-19T00:00:00Z',
      }),
    ];
    const lines = computeVariantLines(events, storeMeta('ck-fish-world'), new Map());

    expect(lines).toHaveLength(0); // never had a real in-stock point, so no line at all
  });
});

describe('computeVariantLines — no point for an unaffected sibling variant (issue #123)', () => {
  it('skips a new point for a variant whose own price is unchanged, even when a sibling variant in the same event genuinely changes', () => {
    const events = [
      variantEvent('2026-05-23T00:00:00Z', [
        { id: 'small', price: 12, available: true },
        { id: 'large', price: 23.5, available: true },
      ]),
      // "small" genuinely changes price; "large" stays at 23.5 -- the exact
      // Shrimpy Business / Pangio kuhlii pattern the user reported.
      variantEvent('2026-06-03T00:00:00Z', [
        { id: 'small', price: 12, available: true },
        { id: 'large', price: 21.95, available: true },
      ]),
    ];
    const lines = computeVariantLines(events, storeMeta('ck-fish-world'), new Map());

    const smallLine = lines.find((l) => l.key.endsWith('::small'))!;
    const largeLine = lines.find((l) => l.key.endsWith('::large'))!;

    // "small" never actually changed price -- no second point.
    expect(smallLine.runs).toHaveLength(1);
    expect(smallLine.runs[0].map((p) => p.price)).toEqual([12]);
    // "large" genuinely changed -- gets its second point.
    expect(largeLine.runs).toHaveLength(1);
    expect(largeLine.runs[0].map((p) => p.price)).toEqual([23.5, 21.95]);
  });

  it('still adds a point when a variant resumes at the same price after a gap (unaffected by this fix)', () => {
    const events = [
      variantEvent('2026-01-01T00:00:00Z', [{ id: 'v1', price: 10, available: true }]),
      variantEvent('2026-01-05T00:00:00Z', [{ id: 'v1', price: 10, available: false }]),
      variantEvent('2026-01-10T00:00:00Z', [{ id: 'v1', price: 10, available: true }]),
    ];
    const [line] = computeVariantLines(events, storeMeta('ck-fish-world'), new Map());

    // Gap-resumption behavior (issue #87/#111) is untouched: two separate
    // runs, each with its own point, regardless of the price matching.
    expect(line.runs).toHaveLength(2);
    expect(line.runs[0].map((p) => p.price)).toEqual([10]);
    expect(line.runs[1].map((p) => p.price)).toEqual([10]);
  });
});
