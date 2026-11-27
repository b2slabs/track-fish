import { expect, test } from 'vitest';
import type { Listing } from '@/types/data';
import { listGalleryImageUrls, selectPrimaryListing } from './select-primary-image';

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

  expect(selectPrimaryListing([newer, older])).toBe(older);
  expect(selectPrimaryListing([older, newer])).toBe(older);
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

  expect(selectPrimaryListing([noImageButEarlier, withImageButLater])).toBe(
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

  expect(selectPrimaryListing([newer, older])).toBe(older);
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

  expect(selectPrimaryListing([a, b])).toBe(b);
});

test('selectPrimaryListing returns undefined for an empty list', () => {
  expect(selectPrimaryListing([])).toBe(undefined);
});

test('listGalleryImageUrls returns every distinct image URL, primary (earliest-firstObservedAt) first', () => {
  const newer = makeListing({
    listingId: 'newer',
    imageUrl: 'https://example.com/newer.jpg',
    firstObservedAt: '2026-02-01T00:00:00.000Z',
  });
  const older = makeListing({
    listingId: 'older',
    imageUrl: 'https://example.com/older.jpg',
    firstObservedAt: '2026-01-01T00:00:00.000Z',
  });

  expect(listGalleryImageUrls([newer, older])).toEqual([
    'https://example.com/older.jpg',
    'https://example.com/newer.jpg',
  ]);
});

test('listGalleryImageUrls dedupes identical image URLs shared by two Listings', () => {
  const a = makeListing({
    listingId: 'a',
    imageUrl: 'https://example.com/same.jpg',
    firstObservedAt: '2026-01-01T00:00:00.000Z',
  });
  const b = makeListing({
    listingId: 'b',
    imageUrl: 'https://example.com/same.jpg',
    firstObservedAt: '2026-02-01T00:00:00.000Z',
  });

  expect(listGalleryImageUrls([a, b])).toEqual(['https://example.com/same.jpg']);
});

test('listGalleryImageUrls skips Listings with no image and returns an empty array when none have one', () => {
  const noImage = makeListing({ imageUrl: null });
  expect(listGalleryImageUrls([noImage])).toEqual([]);
});
