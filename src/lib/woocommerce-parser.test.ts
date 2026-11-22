import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { parseWooCommerceListings } from './woocommerce-parser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(path.join(__dirname, '__fixtures__/woocommerce-sample.json'), 'utf-8')
);
const store = { domain: 'www.wetspottropicalfish.com' };

test('parses every product into a ParsedListing', () => {
  const listings = parseWooCommerceListings(fixture, store);
  assert.equal(listings.length, 3);
});

test('converts the Store API minor-unit price string into a decimal amount', () => {
  const listings = parseWooCommerceListings(fixture, store);
  const peacock = listings.find((l) => l.productIdentifier === '679331')!;
  assert.equal(peacock.price, 9.99);
  assert.equal(peacock.available, true);

  const snail = listings.find((l) => l.productIdentifier === '688021')!;
  assert.equal(snail.price, 6.99);
});

test('derives availability from the top-level is_in_stock flag', () => {
  const listings = parseWooCommerceListings(fixture, store);
  const outOfStock = listings.find((l) => l.productIdentifier === '683465')!;
  assert.equal(outOfStock.available, false);
  assert.equal(outOfStock.price, 39.99);
});

test('synthesizes a single Default variant carrying the overall price/availability', () => {
  const listings = parseWooCommerceListings(fixture, store);
  const peacock = listings.find((l) => l.productIdentifier === '679331')!;
  assert.equal(peacock.variants.length, 1);
  assert.deepEqual(peacock.variants[0], {
    id: '679331',
    label: 'Default',
    price: 9.99,
    available: true,
  });
});

test('decodes numeric HTML entities in the product name', () => {
  const listings = parseWooCommerceListings(fixture, store);
  const microglanis = listings.find((l) => l.productIdentifier === '683465')!;
  assert.equal(microglanis.commonName, 'Microglanis sp. “Colombia”');
});

test('strips HTML tags and decodes entities in the description, preferring the long description', () => {
  const listings = parseWooCommerceListings(fixture, store);
  const peacock = listings.find((l) => l.productIdentifier === '679331')!;
  assert.equal(peacock.description.includes('<p>'), false);
  assert.match(peacock.description, /Diet: Herbivorous – mainly algae grazers\./);
});

test('falls back to the short description when the long description is empty', () => {
  const listings = parseWooCommerceListings(fixture, store);
  const snail = listings.find((l) => l.productIdentifier === '688021')!;
  assert.match(snail.description, /A pack of 8 assorted species of Ramshorn Snails\./);
});

test('uses the permalink directly as the product URL', () => {
  const listings = parseWooCommerceListings(fixture, store);
  const peacock = listings.find((l) => l.productIdentifier === '679331')!;
  assert.equal(peacock.productUrl, 'https://www.wetspottropicalfish.com/product/aulonocara-baenschi/');
});

test('defaults currency to the Store API response currency_code', () => {
  const listings = parseWooCommerceListings(fixture, store);
  assert.ok(listings.every((l) => l.currency === 'USD'));
});

test('respects an explicit store currency override', () => {
  const listings = parseWooCommerceListings(fixture, { ...store, currency: 'CAD' });
  assert.ok(listings.every((l) => l.currency === 'CAD'));
});

test('returns an empty array for malformed raw data', () => {
  assert.deepEqual(parseWooCommerceListings({}, store), []);
  assert.deepEqual(parseWooCommerceListings(null, store), []);
});
