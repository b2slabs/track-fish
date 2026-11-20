import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffListing } from './diff.js';
import type { Listing } from '../types/listing.js';

function makeListing(overrides: Partial<Listing> = {}): Listing {
  return {
    productIdentifier: '1',
    commonName: 'Test Fish',
    description: 'desc',
    productUrl: 'https://example.com/products/test-fish',
    imageUrl: null,
    currency: 'USD',
    price: 10,
    available: true,
    variants: [{ id: 'v1', label: 'Default', price: 10, available: true }],
    listingId: 'store:1',
    storeSlug: 'store',
    storeName: 'Store',
    canonicalFishId: 'cf:store:1',
    firstObservedAt: '2026-01-01T00:00:00.000Z',
    lastObservedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

test('a brand-new Listing (no previous state) is a Change Event tagged first-observed', () => {
  const next = makeListing();
  const event = diffListing(undefined, next);
  assert.equal(event.type, 'change');
  assert.deepEqual(event.changedFields, ['first-observed']);
});

test('identical state across runs is a Heartbeat', () => {
  const previous = makeListing();
  const next = makeListing({ lastObservedAt: '2026-01-02T00:00:00.000Z' });
  const event = diffListing(previous, next);
  assert.equal(event.type, 'heartbeat');
  assert.equal(event.changedFields, undefined);
});

test('a price change is a Change Event naming price', () => {
  const previous = makeListing();
  const next = makeListing({
    price: 12,
    variants: [{ id: 'v1', label: 'Default', price: 12, available: true }],
  });
  const event = diffListing(previous, next);
  assert.equal(event.type, 'change');
  assert.ok(event.changedFields?.includes('price'));
});

test('an availability change is a Change Event naming available', () => {
  const previous = makeListing();
  const next = makeListing({
    available: false,
    variants: [{ id: 'v1', label: 'Default', price: 10, available: false }],
  });
  const event = diffListing(previous, next);
  assert.equal(event.type, 'change');
  assert.ok(event.changedFields?.includes('available'));
});

test('a variant-level change is a Change Event even if the top-level summary is unchanged', () => {
  const previous = makeListing({
    price: 10,
    available: true,
    variants: [
      { id: 'v1', label: 'Small', price: 10, available: true },
      { id: 'v2', label: 'Large', price: 20, available: false },
    ],
  });
  // Top-level price/available stay the same (still 10 / available) but the
  // Large variant flips in stock — this must still surface as a change.
  const next = makeListing({
    price: 10,
    available: true,
    variants: [
      { id: 'v1', label: 'Small', price: 10, available: true },
      { id: 'v2', label: 'Large', price: 20, available: true },
    ],
  });
  const event = diffListing(previous, next);
  assert.equal(event.type, 'change');
  assert.deepEqual(event.changedFields, ['variants']);
});

test('a new variant appearing counts as a change', () => {
  const previous = makeListing({
    variants: [{ id: 'v1', label: 'Small', price: 10, available: true }],
  });
  const next = makeListing({
    variants: [
      { id: 'v1', label: 'Small', price: 10, available: true },
      { id: 'v2', label: 'Large', price: 20, available: true },
    ],
  });
  const event = diffListing(previous, next);
  assert.equal(event.type, 'change');
  assert.deepEqual(event.changedFields, ['variants']);
});
