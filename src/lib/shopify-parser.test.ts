import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { parseShopifyListings } from './shopify-parser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(path.join(__dirname, '__fixtures__/shopify-sample.json'), 'utf-8')
);
const store = { domain: 'aquaticarts.com' };

test('parses every product into a ParsedListing', () => {
  const listings = parseShopifyListings(fixture, store);
  assert.equal(listings.length, 4);
});

test('derives price as the lowest in-stock variant price', () => {
  const listings = parseShopifyListings(fixture, store);
  const peugeotTetra = listings.find((l) => l.productIdentifier === '15461769412975')!;
  assert.equal(peugeotTetra.price, 74.99);
  assert.equal(peugeotTetra.available, true);
});

test('falls back to the lowest overall price when no variant is in stock', () => {
  const listings = parseShopifyListings(fixture, store);
  const loach = listings.find((l) => l.productIdentifier === '4741462790')!;
  assert.equal(loach.available, false);
  assert.equal(loach.price, 37.99);
});

test('is available when at least one variant is in stock, even if others are not', () => {
  const listings = parseShopifyListings(fixture, store);
  const guppy = listings.find((l) => l.productIdentifier === '15109197660527')!;
  assert.equal(guppy.available, true);
  // Price should come from the one in-stock variant (16.99), not the cheapest overall.
  assert.equal(guppy.price, 16.99);
  assert.equal(guppy.variants.length, 3);
});

test('extracts size/grade variant labels, product url, image, and plain-text description', () => {
  const listings = parseShopifyListings(fixture, store);
  const goodeid = listings.find((l) => l.productIdentifier === '15446431990127')!;
  assert.deepEqual(
    goodeid.variants.map((v) => v.label),
    ['1 Male (Locally Bred)', '1 Female (locally Bred)', '1 Pair ( 1 Male + 1 Female LB )']
  );
  assert.equal(goodeid.productUrl, 'https://aquaticarts.com/products/blue-tail-goodeid-ataeniobius-toweri');
  assert.match(goodeid.imageUrl ?? '', /^https:\/\/cdn\.shopify\.com/);
  assert.equal(goodeid.description.includes('<p>'), false);
  assert.match(goodeid.description, /Sample description for Blue Tail Goodeid/);
});

test('defaults currency to USD when the store has none configured', () => {
  const listings = parseShopifyListings(fixture, store);
  assert.ok(listings.every((l) => l.currency === 'USD'));
});

test('respects an explicit store currency', () => {
  const listings = parseShopifyListings(fixture, { ...store, currency: 'CAD' });
  assert.ok(listings.every((l) => l.currency === 'CAD'));
});

test('returns an empty array for malformed raw data', () => {
  assert.deepEqual(parseShopifyListings({}, store), []);
  assert.deepEqual(parseShopifyListings(null, store), []);
});
