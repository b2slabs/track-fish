import { describe, expect, it } from 'vitest';
import { computeVariantLines, type StoreMeta } from './PriceHistoryChart';
import type { HistoryEvent } from '@/types/data';

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

function event(
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
      event('2026-01-08T00:00:00Z', [{ id: 'v1', price: 59.98, available: true }]),
      event('2026-11-24T00:00:00Z', [{ id: 'v1', price: 59.98, available: true }]),
    ];
    const [line] = computeVariantLines(events, storeMeta('ck-fish-world'), new Map());
    expect(line.runs).toHaveLength(1);
    expect(line.runs[0]).toHaveLength(2);
  });

  it('does not break the line when a same-price point follows an out-of-stock gap (CK Fish World / Panda Cory, issue #87)', () => {
    const events = [
      event('2026-01-08T00:00:00Z', [{ id: 'v1', price: 59.98, available: true }]),
      // Hard evidence of a gap in between (explicit out-of-stock reading).
      event('2026-06-01T00:00:00Z', [{ id: 'v1', price: 59.98, available: false }]),
      // Resumes at the exact same price as before the gap.
      event('2026-11-20T00:00:00Z', [{ id: 'v1', price: 59.98, available: true }]),
      event('2026-11-24T00:00:00Z', [{ id: 'v1', price: 59.98, available: true }]),
    ];
    const [line] = computeVariantLines(events, storeMeta('ck-fish-world'), new Map());
    expect(line.runs).toHaveLength(1);
    expect(line.runs[0].map((p) => p.price)).toEqual([59.98, 59.98, 59.98]);
  });

  it('still breaks the line on a genuine out-of-stock gap that resumes at a different price', () => {
    const events = [
      event('2026-01-08T00:00:00Z', [{ id: 'v1', price: 59.98, available: true }]),
      event('2026-06-01T00:00:00Z', [{ id: 'v1', price: 59.98, available: false }]),
      // Resumes at a genuinely different price — a real, meaningful change.
      event('2026-11-20T00:00:00Z', [{ id: 'v1', price: 64.99, available: true }]),
    ];
    const [line] = computeVariantLines(events, storeMeta('ck-fish-world'), new Map());
    expect(line.runs).toHaveLength(2);
    expect(line.runs[0].map((p) => p.price)).toEqual([59.98]);
    expect(line.runs[1].map((p) => p.price)).toEqual([64.99]);
  });

  it('still breaks the line when a variant is removed and a different variant later reappears at a different price', () => {
    const events = [
      event('2026-01-08T00:00:00Z', [{ id: 'v1', price: 59.98, available: true }]),
      // v1 entirely absent from this later event — hard evidence of removal.
      event('2026-06-01T00:00:00Z', [{ id: 'v2', price: 10, available: true }]),
      event('2026-11-20T00:00:00Z', [
        { id: 'v1', price: 70, available: true },
        { id: 'v2', price: 10, available: true },
      ]),
    ];
    const [v1Line] = computeVariantLines(events, storeMeta('ck-fish-world'), new Map()).filter(
      (l) => l.key.endsWith('::v1'),
    );
    expect(v1Line.runs).toHaveLength(2);
  });
});
