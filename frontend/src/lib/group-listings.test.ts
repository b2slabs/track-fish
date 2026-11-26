import { expect, test } from 'vitest';
import type { Listing } from '@/types/data';
import { pickRepresentative } from './group-listings';

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
