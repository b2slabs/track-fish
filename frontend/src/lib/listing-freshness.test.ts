import { expect, test } from 'vitest';
import { displayListingStatus, isListingStale, isSoldOutPlaceholder } from './listing-freshness';

test('isSoldOutPlaceholder: a Listing priced at 0.00 is the sold-out placeholder', () => {
  expect(isSoldOutPlaceholder(0)).toBe(true);
});

test('isSoldOutPlaceholder: a Listing with a real nonzero price is not the placeholder', () => {
  expect(isSoldOutPlaceholder(24.99)).toBe(false);
});

const NOW = new Date('2026-11-26T12:00:00.000Z');

test('isListingStale: a Listing observed in its Store\'s latest run is not stale', () => {
  const stores = { petco: { lastSuccessfulRunAt: '2026-11-26T09:00:00.000Z' } };
  const listing = { storeSlug: 'petco', lastObservedAt: '2026-11-26T09:00:00.000Z' };
  expect(isListingStale(listing, stores, NOW)).toBe(false);
});

test('isListingStale: a Listing that vanished from its Store\'s catalog (Store ran again without re-observing it) is stale immediately, even though the gap is small', () => {
  const stores = { petco: { lastSuccessfulRunAt: '2026-11-26T09:00:00.000Z' } };
  const listing = { storeSlug: 'petco', lastObservedAt: '2026-11-25T09:00:00.000Z' };
  expect(isListingStale(listing, stores, NOW)).toBe(true);
});

test('isListingStale: a Listing whose Store has not run successfully in a long time is stale even though the Listing itself was observed in that (old) run', () => {
  const stores = { petco: { lastSuccessfulRunAt: '2026-11-10T09:00:00.000Z' } };
  const listing = { storeSlug: 'petco', lastObservedAt: '2026-11-10T09:00:00.000Z' };
  expect(isListingStale(listing, stores, NOW)).toBe(true);
});

test('isListingStale: a Listing whose Store is missing from the index (defensive) is not treated as stale', () => {
  const stores = {};
  const listing = { storeSlug: 'unknown-store', lastObservedAt: '2026-11-26T09:00:00.000Z' };
  expect(isListingStale(listing, stores, NOW)).toBe(false);
});

test('displayListingStatus: a fresh, available, real-priced Listing displays as available with its real price (unaffected by this fix)', () => {
  const stores = { petco: { lastSuccessfulRunAt: '2026-11-26T09:00:00.000Z' } };
  const listing = {
    storeSlug: 'petco',
    lastObservedAt: '2026-11-26T09:00:00.000Z',
    available: true,
    price: 24.99,
  };
  expect(displayListingStatus(listing, stores, NOW)).toEqual({ available: true, price: 24.99 });
});

test('displayListingStatus: a Listing priced at the $0.00 sold-out placeholder never displays as available with that price', () => {
  const stores = { petco: { lastSuccessfulRunAt: '2026-11-26T09:00:00.000Z' } };
  const listing = {
    storeSlug: 'petco',
    lastObservedAt: '2026-11-26T09:00:00.000Z',
    available: true,
    price: 0,
  };
  expect(displayListingStatus(listing, stores, NOW)).toEqual({ available: false, price: null });
});

test('displayListingStatus: a stale (vanished) Listing no longer displays as available even though its own `available` flag still says true', () => {
  const stores = { petco: { lastSuccessfulRunAt: '2026-11-26T09:00:00.000Z' } };
  const listing = {
    storeSlug: 'petco',
    lastObservedAt: '2026-11-25T09:00:00.000Z',
    available: true,
    price: 19.99,
  };
  const status = displayListingStatus(listing, stores, NOW);
  expect(status.available).toBe(false);
});

test('displayListingStatus: a Listing genuinely out of stock (fresh, real price) stays out of stock, still shows its real price', () => {
  const stores = { petco: { lastSuccessfulRunAt: '2026-11-26T09:00:00.000Z' } };
  const listing = {
    storeSlug: 'petco',
    lastObservedAt: '2026-11-26T09:00:00.000Z',
    available: false,
    price: 19.99,
  };
  expect(displayListingStatus(listing, stores, NOW)).toEqual({ available: false, price: 19.99 });
});
