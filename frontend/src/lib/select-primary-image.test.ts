import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Listing } from '@/types/data';
import { selectPrimaryListing } from './select-primary-image';

function makeListing(overrides: Partial<Listing>): Listing {
  return {
    productIdentifier: 'p',
    commonName: 'Fish',
    description: '',
    productUrl: 'https://example.com',
    imageUrl: null,
    currency: 'USD',
    price: 10,
    available: true,
    variants: [],
    listingId: 'listing-a',
    storeSlug: 'store-a',
    storeName: 'Store A',
    canonicalFishId: 'fish-1',
    firstObservedAt: '2026-01-01T00:00:00.000Z',
    lastObservedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

test('selectPrimaryListing picks the earliest-firstObservedAt Listing that has an image', () => {
  const older = makeListing({
    listingId: 'older',
    imageUrl: 'https://example.com/older.jpg',
    firstObservedAt: '2026-01-01T00:00:00.000Z',
  });
  const newer = makeListing({
    listingId: 'newer',
    imageUrl: 'https://example.com/newer.jpg',
    firstObservedAt: '2026-02-01T00:00:00.000Z',
  });

  assert.equal(selectPrimaryListing([newer, older]), older);
  assert.equal(selectPrimaryListing([older, newer]), older);
});

test('selectPrimaryListing ignores Listings without an image, even if they are earlier', () => {
  const noImageButEarlier = makeListing({
    listingId: 'no-image',
    imageUrl: null,
    firstObservedAt: '2026-01-01T00:00:00.000Z',
  });
  const withImageButLater = makeListing({
    listingId: 'with-image',
    imageUrl: 'https://example.com/photo.jpg',
    firstObservedAt: '2026-03-01T00:00:00.000Z',
  });

  assert.equal(
    selectPrimaryListing([noImageButEarlier, withImageButLater]),
    withImageButLater,
  );
});

test('selectPrimaryListing falls back to the earliest Listing overall when none has an image', () => {
  const older = makeListing({
    listingId: 'older',
    imageUrl: null,
    firstObservedAt: '2026-01-01T00:00:00.000Z',
  });
  const newer = makeListing({
    listingId: 'newer',
    imageUrl: null,
    firstObservedAt: '2026-02-01T00:00:00.000Z',
  });

  assert.equal(selectPrimaryListing([newer, older]), older);
});

test('selectPrimaryListing breaks ties by listingId when firstObservedAt matches', () => {
  const a = makeListing({
    listingId: 'b-listing',
    imageUrl: 'https://example.com/b.jpg',
    firstObservedAt: '2026-01-01T00:00:00.000Z',
  });
  const b = makeListing({
    listingId: 'a-listing',
    imageUrl: 'https://example.com/a.jpg',
    firstObservedAt: '2026-01-01T00:00:00.000Z',
  });

  assert.equal(selectPrimaryListing([a, b]), b);
});

test('selectPrimaryListing returns undefined for an empty list', () => {
  assert.equal(selectPrimaryListing([]), undefined);
});
