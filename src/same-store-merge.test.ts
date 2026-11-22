import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { processStoreRun, type StoreConfig } from './process.js';
import { readIndexFile, readHistoryFile, writeIndexFile, writeHistoryFile } from './lib/data-branch.js';
import type { CanonicalFishHistory } from './types/listing.js';

/**
 * End-to-end tests for issue #56's "same Store, same Canonical Fish, two
 * separate Shopify products" merge: a Store selling the same fish as two
 * (or more) distinct Shopify products -- most commonly one per pack size --
 * must land on one logical Listing, not two, once both resolve to the same
 * canonicalFishId.
 */

const store: StoreConfig = { name: 'AquariumFish.com', slug: 'aquarium-fish', domain: 'aquariumfish.com', platform: 'shopify' };

function withTempDataDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(path.join(tmpdir(), 'track-fish-same-store-merge-test-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function rawTwoProducts(
  overrides: Partial<{ idA: number; idB: number; titleA: string; titleB: string; priceA: string; priceB: string }> = {}
) {
  const { idA = 1, idB = 2, titleA = 'White Cloud Minnow', titleB = 'White Cloud Minnow (School of 6)', priceA = '2.99', priceB = '15.59' } =
    overrides;
  return {
    products: [
      {
        id: idA,
        title: titleA,
        handle: String(idA),
        body_html: '<p>White Cloud Mountain Minnow (Tanichthys albonubes)</p>',
        variants: [{ id: idA * 10, title: 'Default Title', price: priceA, available: true }],
        images: [],
        options: [{ name: 'Title' }],
      },
      {
        id: idB,
        title: titleB,
        handle: String(idB),
        body_html: '<p>White Cloud Mountain Minnow (Tanichthys albonubes)</p>',
        variants: [{ id: idB * 10, title: 'Default Title', price: priceB, available: true }],
        images: [],
        options: [{ name: 'Title' }],
      },
    ],
  };
}

test('two same-Store Listings that resolve to the same Canonical Fish merge into one Listing with both variants', () => {
  withTempDataDir((dataDir) => {
    const result = processStoreRun({
      store,
      rawData: rawTwoProducts(),
      dataDir,
      now: new Date('2026-11-18T00:00:00.000Z'),
    });

    assert.equal(result.accepted, true);
    assert.equal(result.listingCount, 2);

    const index = readIndexFile(dataDir);
    // One Listing, not two, for this Store under this Canonical Fish.
    const storeListings = index.listings.filter((l) => l.storeSlug === 'aquarium-fish');
    assert.equal(storeListings.length, 1);

    const merged = storeListings[0];
    assert.equal(merged.listingId, 'aquarium-fish:1+2');
    assert.equal(merged.canonicalFishId, 'cf:sci:tanichthys-albonubes:white');
    assert.equal(merged.variants.length, 2);
    // Neither sub-Listing's variant label was the literal Shopify
    // single-variant placeholder "Title" in the combined array -- both
    // came from genuinely single-variant products, so each should have
    // been relabeled to its own source Listing's commonName.
    assert.ok(merged.variants.every((v) => v.label !== 'Title'));
    const labels = merged.variants.map((v) => v.label).sort();
    assert.deepEqual(labels, ['White Cloud Minnow', 'White Cloud Minnow (School of 6)']);
    // The representative commonName is the shortest of the two titles.
    assert.equal(merged.commonName, 'White Cloud Minnow');
    // Representative price is the lowest in-stock price across both.
    assert.equal(merged.price, 2.99);

    const history = readHistoryFile(dataDir, merged.canonicalFishId) as CanonicalFishHistory;
    assert.equal(history.listings.length, 1);
    assert.equal(history.listings[0].listingId, 'aquarium-fish:1+2');
    assert.equal(history.events.length, 1);
    assert.deepEqual(history.events[0].changedFields, ['first-observed']);
  });
});

test('a same-Store merge preserves both sub-Listings\' prior history under the new merged listingId', () => {
  withTempDataDir((dataDir) => {
    // First run: two same-Store Listings that both extract the same
    // scientific name, so they merge into one Listing right away.
    processStoreRun({
      store,
      rawData: {
        products: [
          {
            id: 1,
            title: 'White Cloud Minnow',
            handle: '1',
            body_html: '<p>White Cloud Mountain Minnow (Tanichthys albonubes)</p>',
            variants: [{ id: 10, title: 'Default Title', price: '2.99', available: true }],
            images: [],
            options: [],
          },
          {
            id: 2,
            title: 'White Cloud Minnow (School of 6)',
            handle: '2',
            body_html: '<p>White Cloud Mountain Minnow (Tanichthys albonubes)</p>',
            variants: [{ id: 20, title: 'Default Title', price: '15.59', available: true }],
            images: [],
            options: [],
          },
        ],
      },
      dataDir,
      now: new Date('2026-11-18T00:00:00.000Z'),
    });

    const beforeIndex = readIndexFile(dataDir);
    const beforeStoreListings = beforeIndex.listings.filter((l) => l.storeSlug === 'aquarium-fish');
    // Both titles extract the same scientific name, so they already landed
    // on one shared canonicalFishId pre-merge-fix -- two Listings, one
    // Canonical Fish, exactly issue #56's reported shape.
    assert.equal(beforeStoreListings.length, 1, 'the merge fix already collapsed them on the very first run');

    // Second run: same two products, price changes on one of them.
    const second = processStoreRun({
      store,
      rawData: rawTwoProducts({ priceB: '16.99' }),
      dataDir,
      now: new Date('2026-11-19T00:00:00.000Z'),
    });
    assert.equal(second.accepted, true);

    const index = readIndexFile(dataDir);
    const storeListings = index.listings.filter((l) => l.storeSlug === 'aquarium-fish');
    assert.equal(storeListings.length, 1, 'still one merged Listing, not duplicated across runs');
    assert.equal(storeListings[0].firstObservedAt, '2026-11-18T00:00:00.000Z', 'firstObservedAt carried through');

    const history = readHistoryFile(dataDir, storeListings[0].canonicalFishId) as CanonicalFishHistory;
    assert.equal(history.events.length, 2);
    assert.equal(history.events[1].type, 'change');
  });
});

test('migrating real pre-fix data: two already-separate listingIds with their own existing history get merged and both histories survive', () => {
  withTempDataDir((dataDir) => {
    const canonicalFishId = 'cf:sci:tanichthys-albonubes:white';
    const now = '2026-11-20T06:27:42.901Z';

    // Simulate the exact shape production data was in before this fix:
    // two separate Listings, same Store, already both matched to this
    // Canonical Fish, each with its own pre-existing history.
    writeIndexFile(dataDir, {
      generatedAt: now,
      stores: { 'aquarium-fish': { name: 'AquariumFish.com', domain: 'aquariumfish.com', lastSuccessfulRunAt: now, lastSuccessfulListingCount: 2 } },
      listings: [
        {
          productIdentifier: '1',
          commonName: 'White Cloud Minnow',
          description: 'White Cloud Mountain Minnow (Tanichthys albonubes)',
          productUrl: 'https://aquariumfish.com/products/white-cloud-minnow',
          imageUrl: null,
          currency: 'USD',
          price: 2.99,
          available: true,
          variants: [{ id: '10', label: 'Title', price: 2.99, available: true }],
          listingId: 'aquarium-fish:1',
          storeSlug: 'aquarium-fish',
          storeName: 'AquariumFish.com',
          canonicalFishId,
          scientificName: 'Tanichthys albonubes',
          firstObservedAt: now,
          lastObservedAt: now,
        },
        {
          productIdentifier: '2',
          commonName: 'White Cloud Minnow (School of 6)',
          description: 'White Cloud Mountain Minnow (Tanichthys albonubes)',
          productUrl: 'https://aquariumfish.com/products/white-cloud-minnow-school-of-6',
          imageUrl: null,
          currency: 'USD',
          price: 15.59,
          available: true,
          variants: [{ id: '20', label: 'Title', price: 15.59, available: true }],
          listingId: 'aquarium-fish:2',
          storeSlug: 'aquarium-fish',
          storeName: 'AquariumFish.com',
          canonicalFishId,
          scientificName: 'Tanichthys albonubes',
          firstObservedAt: now,
          lastObservedAt: now,
        },
      ],
    });
    writeHistoryFile(dataDir, {
      canonicalFishId,
      commonName: 'White Cloud Minnow (School of 6)',
      scientificName: 'Tanichthys albonubes',
      listings: [
        { listingId: 'aquarium-fish:1', storeSlug: 'aquarium-fish', storeName: 'AquariumFish.com', commonName: 'White Cloud Minnow' },
        { listingId: 'aquarium-fish:2', storeSlug: 'aquarium-fish', storeName: 'AquariumFish.com', commonName: 'White Cloud Minnow (School of 6)' },
      ],
      events: [
        {
          listingId: 'aquarium-fish:1',
          storeSlug: 'aquarium-fish',
          type: 'change',
          observedAt: now,
          price: 2.99,
          currency: 'USD',
          available: true,
          variants: [{ id: '10', label: 'Title', price: 2.99, available: true }],
          changedFields: ['first-observed'],
        },
        {
          listingId: 'aquarium-fish:2',
          storeSlug: 'aquarium-fish',
          type: 'change',
          observedAt: now,
          price: 15.59,
          currency: 'USD',
          available: true,
          variants: [{ id: '20', label: 'Title', price: 15.59, available: true }],
          changedFields: ['first-observed'],
        },
      ],
    });

    const result = processStoreRun({
      store,
      rawData: rawTwoProducts(),
      dataDir,
      now: new Date('2026-11-21T16:38:40.438Z'),
    });
    assert.equal(result.accepted, true);

    const index = readIndexFile(dataDir);
    const storeListings = index.listings.filter((l) => l.storeSlug === 'aquarium-fish');
    assert.equal(storeListings.length, 1, 'the two pre-existing Listings were consolidated, not left as stale duplicates');
    assert.equal(storeListings[0].listingId, 'aquarium-fish:1+2');

    const history = readHistoryFile(dataDir, canonicalFishId) as CanonicalFishHistory;
    assert.equal(history.listings.length, 1);
    assert.equal(history.listings[0].listingId, 'aquarium-fish:1+2');
    // Both pre-existing events (one per old listingId) survive the merge,
    // retagged onto the new merged listingId, plus this run's own event.
    assert.equal(history.events.length, 3);
    assert.ok(history.events.every((e) => e.listingId === 'aquarium-fish:1+2'));
    const prices = history.events.map((e) => e.price).sort((a, b) => a - b);
    assert.deepEqual(prices, [2.99, 2.99, 15.59]);
  });
});

test('a bundle/combo Listing never merges with a same-Store, same-Canonical-Fish sibling, even one eligible to merge with another', () => {
  withTempDataDir((dataDir) => {
    const result = processStoreRun({
      store,
      rawData: {
        products: [
          {
            id: 1,
            title: 'White Cloud Minnow',
            handle: '1',
            body_html: '<p>White Cloud Mountain Minnow (Tanichthys albonubes)</p>',
            variants: [{ id: 10, title: 'Default Title', price: '2.99', available: true }],
            images: [],
            options: [{ name: 'Title' }],
          },
          {
            id: 2,
            title: 'White Cloud Minnow (School of 6)',
            handle: '2',
            body_html: '<p>White Cloud Mountain Minnow (Tanichthys albonubes)</p>',
            variants: [{ id: 20, title: 'Default Title', price: '15.59', available: true }],
            images: [],
            options: [{ name: 'Title' }],
          },
          {
            id: 3,
            // Same species/canonicalFishId as the two plain Listings above,
            // but a combo-box product -- must stay its own standalone
            // Listing, not get folded into (or anchor) a merge group.
            title: 'White Cloud Minnow Variety Pack Combo Box',
            handle: '3',
            body_html: '<p>White Cloud Mountain Minnow (Tanichthys albonubes)</p>',
            variants: [{ id: 30, title: 'Default Title', price: '12.00', available: true }],
            images: [],
            options: [{ name: 'Title' }],
          },
        ],
      },
      dataDir,
      now: new Date('2026-11-18T00:00:00.000Z'),
    });

    assert.equal(result.accepted, true);

    const index = readIndexFile(dataDir);
    const storeListings = index.listings.filter((l) => l.storeSlug === 'aquarium-fish');
    // Two Listings: the plain pair merged into one, the bundle standing alone.
    assert.equal(storeListings.length, 2);

    const merged = storeListings.find((l) => l.listingId === 'aquarium-fish:1+2');
    assert.ok(merged, 'the two plain Listings still merge with each other');
    assert.equal(merged!.variants.length, 2);

    const bundle = storeListings.find((l) => l.listingId === 'aquarium-fish:3');
    assert.ok(bundle, 'the combo-box Listing keeps its own standalone listingId');
    assert.equal(bundle!.variants.length, 1);
    assert.equal(bundle!.commonName, 'White Cloud Minnow Variety Pack Combo Box');
    assert.equal(bundle!.canonicalFishId, merged!.canonicalFishId, 'same Canonical Fish, still not merged');
  });
});

test('a group of three same-Store, same-Canonical-Fish bundle Listings never merge with each other either', () => {
  withTempDataDir((dataDir) => {
    const bundleProduct = (id: number, title: string, price: string) => ({
      id,
      title,
      handle: String(id),
      body_html: '<p>Carbon Rili Shrimp (Neocaridina davidi)</p>',
      variants: [{ id: id * 10, title: 'Default Title', price, available: true }],
      images: [],
      options: [{ name: 'Title' }],
    });

    const result = processStoreRun({
      store: { name: 'Aquatic Arts', slug: 'aquatic-arts', domain: 'aquaticarts.com', platform: 'shopify' },
      rawData: {
        products: [
          bundleProduct(1, 'Carbon Rili Shrimp Breeder Combo Box', '40.00'),
          bundleProduct(2, 'Wild Form Neocaridina Shrimp Breeder Combo Box', '35.00'),
          bundleProduct(3, 'Bred by Aquatic Arts Mix & Match Shrimp Combo Box – Choose 2', '30.00'),
        ],
      },
      dataDir,
      now: new Date('2026-11-18T00:00:00.000Z'),
    });

    assert.equal(result.accepted, true);

    const index = readIndexFile(dataDir);
    const storeListings = index.listings.filter((l) => l.storeSlug === 'aquatic-arts');
    assert.equal(storeListings.length, 3, 'three distinct combo-box Listings, none merged with each other');
    for (const l of storeListings) {
      assert.equal(l.variants.length, 1);
    }
  });
});
