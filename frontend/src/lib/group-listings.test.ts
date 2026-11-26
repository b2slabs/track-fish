import { expect, test } from 'vitest';
import type { Listing } from '@/types/data';
import { groupListingsByCanonicalFish, pickRepresentative } from './group-listings';

function listing(overrides: Partial<Listing>): Listing {
  return {
    productIdentifier: 'id',
    commonName: 'Fish',
    description: '',
    productUrl: '',
    imageUrl: null,
    currency: 'USD',
    price: 10,
    available: true,
    variants: [],
    listingId: 'store:id',
    storeSlug: 'store',
    storeName: 'Store',
    canonicalFishId: 'cf:sci:fish',
    scientificName: null,
    firstObservedAt: '2026-01-01T00:00:00.000Z',
    lastObservedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// Regression test for issue #91: FishDetailPage now reuses this exact
// function (instead of its own "whichever Listing has an image" rule) so
// the detail page's header name agrees with the browse grid's card for
// the same Canonical Fish. Exercised here at the single shared seam both
// pages now call through.
test('pickRepresentative picks the same Listing regardless of which one happens to carry an image', () => {
  const noImageButCheaper = listing({
    listingId: 'a:1',
    storeSlug: 'a',
    price: 5,
    commonName: 'Cheaper, No Image',
    imageUrl: null,
  });
  const imageButPricier = listing({
    listingId: 'b:1',
    storeSlug: 'b',
    price: 20,
    commonName: 'Pricier, Has Image',
    imageUrl: 'https://example.com/fish.jpg',
  });

  const result = pickRepresentative([imageButPricier, noImageButCheaper]);

  expect(result.listingId).toBe('a:1');
});

// Regression test: FishDetailPage must pass `index.stores` into
// pickRepresentative, the same way BrowsePage does, or its representative
// pick silently ignores staleness (issue #86) and can disagree with the
// browse grid's pick for the same Canonical Fish -- undermining #91's
// "search and detail page must agree" acceptance criterion.
test('pickRepresentative treats a stale (vanished) Listing as unavailable when store freshness data is supplied, picking the fresh alternative instead', () => {
  const stale = listing({
    listingId: 'stale:1',
    storeSlug: 'stale-store',
    price: 5,
    available: true,
    lastObservedAt: '2026-11-20T00:00:00.000Z',
  });
  const fresh = listing({
    listingId: 'fresh:1',
    storeSlug: 'fresh-store',
    price: 20,
    available: true,
    lastObservedAt: '2026-11-26T00:00:00.000Z',
  });
  const stores = {
    'stale-store': { lastSuccessfulRunAt: '2026-11-26T00:00:00.000Z' },
    'fresh-store': { lastSuccessfulRunAt: '2026-11-26T00:00:00.000Z' },
  };
  const now = new Date('2026-11-26T12:00:00.000Z');

  const result = pickRepresentative([stale, fresh], stores, now);

  expect(result.listingId).toBe('fresh:1');
});

const NOW = new Date('2026-11-26T12:00:00.000Z');

function makeListing(overrides: Partial<Listing>): Listing {
  return listing({
    productIdentifier: 'p1',
    commonName: 'Neon Tetra',
    productUrl: 'https://example.com/p1',
    price: 4.99,
    variants: [{ id: 'v1', label: 'Title', price: 4.99, available: true }],
    listingId: 'store:p1',
    canonicalFishId: 'neon-tetra',
    firstObservedAt: '2026-11-01T00:00:00.000Z',
    lastObservedAt: '2026-11-26T09:00:00.000Z',
    ...overrides,
  });
}

test('groupListingsByCanonicalFish: a stale (vanished) Listing no longer makes its group read as available, even though its own `available` flag is true', () => {
  const stores = { store: { lastSuccessfulRunAt: '2026-11-26T09:00:00.000Z' } };
  const staleListing = makeListing({ lastObservedAt: '2026-11-25T09:00:00.000Z' }); // Store ran again since this was last observed
  const [group] = groupListingsByCanonicalFish([staleListing], stores, NOW);
  expect(group.available).toBe(false);
  expect(group.inStockStoreCount).toBe(0);
});

test('groupListingsByCanonicalFish: a fresh, in-stock, real-priced Listing is unaffected and drives the group as before', () => {
  const stores = { store: { lastSuccessfulRunAt: '2026-11-26T09:00:00.000Z' } };
  const freshListing = makeListing({});
  const [group] = groupListingsByCanonicalFish([freshListing], stores, NOW);
  expect(group.available).toBe(true);
  expect(group.inStockStoreCount).toBe(1);
  expect(group.representative.price).toBe(4.99);
});

test('groupListingsByCanonicalFish: the $0.00 sold-out placeholder is never picked as the representative price when a real-priced alternative exists in the group', () => {
  const stores = {
    'store-a': { lastSuccessfulRunAt: '2026-11-26T09:00:00.000Z' },
    'store-b': { lastSuccessfulRunAt: '2026-11-26T09:00:00.000Z' },
  };
  const placeholderListing = makeListing({
    storeSlug: 'store-a',
    listingId: 'store-a:p1',
    price: 0,
    available: true,
  });
  const realListing = makeListing({
    storeSlug: 'store-b',
    listingId: 'store-b:p1',
    price: 7.49,
    available: false, // out of stock, but still a real price -- the fallback tier
  });
  const [group] = groupListingsByCanonicalFish([placeholderListing, realListing], stores, NOW);
  expect(group.representative.price).toBe(7.49);
});
