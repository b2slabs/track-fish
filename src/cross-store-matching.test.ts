import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { processStoreRun, type StoreConfig } from './process.js';
import { readIndexFile, readHistoryFile, readPendingMatches } from './lib/data-branch.js';
import type { CanonicalFishHistory } from './types/listing.js';

/**
 * End-to-end tests for issue #3: running the pipeline for two different
 * Stores against the same `data` directory, exercising the full
 * scientific-name / fuzzy / ambiguous matching flow that a single-Store
 * test (see process.test.ts) can't reach.
 */

const storeA: StoreConfig = { name: 'Aquatic Arts', slug: 'aquatic-arts', domain: 'aquaticarts.com', platform: 'shopify' };
const storeB: StoreConfig = { name: 'Monster Aquarium', slug: 'monster-aquarium', domain: 'monsteraquariumon9.com', platform: 'shopify' };

function withTempDataDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(path.join(tmpdir(), 'track-fish-cross-store-test-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function rawProduct(id: number, title: string, price: string, available = true) {
  return {
    products: [
      {
        id,
        title,
        handle: String(id),
        body_html: '',
        variants: [{ id: id * 10, title: 'Default Title', price, available }],
        images: [],
        options: [],
      },
    ],
  };
}

test('two Listings from different Stores with the same scientific name merge into one Canonical Fish history', () => {
  withTempDataDir((dataDir) => {
    processStoreRun({
      store: storeA,
      rawData: rawProduct(1, 'Blue Cobalt Discus (Symphysodon aequifasciatus)', '80.00'),
      dataDir,
      now: new Date('2026-11-18T00:00:00.000Z'),
    });
    processStoreRun({
      store: storeB,
      rawData: rawProduct(2, "Dealer's Choice Discus (Symphysodon aequifasciatus)", '45.00'),
      dataDir,
      now: new Date('2026-11-18T00:00:01.000Z'),
    });

    const index = readIndexFile(dataDir);
    const listingA = index.listings.find((l) => l.listingId === 'aquatic-arts:1')!;
    const listingB = index.listings.find((l) => l.listingId === 'monster-aquarium:2')!;

    assert.equal(listingA.canonicalFishId, 'cf:sci:symphysodon-aequifasciatus');
    assert.equal(listingB.canonicalFishId, listingA.canonicalFishId);

    const history = readHistoryFile(dataDir, listingA.canonicalFishId) as CanonicalFishHistory;
    assert.equal(history.listings.length, 2);
    const storeSlugs = history.listings.map((l) => l.storeSlug).sort();
    assert.deepEqual(storeSlugs, ['aquatic-arts', 'monster-aquarium']);
    assert.equal(history.events.length, 2);
    assert.equal(history.scientificName, 'Symphysodon aequifasciatus');
  });
});

test('a confident fuzzy common-name match across Stores (no scientific name) also merges', () => {
  withTempDataDir((dataDir) => {
    processStoreRun({
      store: storeA,
      rawData: rawProduct(10, 'Blue Tail Goodeid', '14.00'),
      dataDir,
      now: new Date('2026-11-18T00:00:00.000Z'),
    });
    processStoreRun({
      store: storeB,
      rawData: rawProduct(20, 'Blue-Tail Goodeid', '12.00'),
      dataDir,
      now: new Date('2026-11-18T00:00:01.000Z'),
    });

    const index = readIndexFile(dataDir);
    const listingA = index.listings.find((l) => l.listingId === 'aquatic-arts:10')!;
    const listingB = index.listings.find((l) => l.listingId === 'monster-aquarium:20')!;

    assert.equal(listingA.canonicalFishId, 'cf:aquatic-arts:10');
    assert.equal(listingB.canonicalFishId, listingA.canonicalFishId); // fuzzy-merged onto A's id

    const history = readHistoryFile(dataDir, listingA.canonicalFishId) as CanonicalFishHistory;
    assert.equal(history.listings.length, 2);
  });
});

test('an ambiguous cross-store match is recorded in pending-matches.json, not auto-merged', () => {
  withTempDataDir((dataDir) => {
    processStoreRun({
      store: storeA,
      rawData: rawProduct(30, 'Blue Cobalt Discus', '80.00'),
      dataDir,
      now: new Date('2026-11-18T00:00:00.000Z'),
    });
    processStoreRun({
      store: storeB,
      rawData: rawProduct(40, 'Blue Diamond Discus', '95.00'),
      dataDir,
      now: new Date('2026-11-18T00:00:01.000Z'),
    });

    const index = readIndexFile(dataDir);
    const listingA = index.listings.find((l) => l.listingId === 'aquatic-arts:30')!;
    const listingB = index.listings.find((l) => l.listingId === 'monster-aquarium:40')!;

    // Each stays on its own trivial id -- not auto-merged, not dropped.
    assert.notEqual(listingA.canonicalFishId, listingB.canonicalFishId);

    const pending = readPendingMatches(dataDir);
    const entry = pending.find((p) => p.listingId === 'monster-aquarium:40');
    assert.ok(entry, 'expected an ambiguous pending-match entry for the second Listing');
    assert.equal(entry!.candidateCanonicalFishId, listingA.canonicalFishId);
  });
});

test('history is preserved, not lost or duplicated, when a Listing is repointed to a merged Canonical Fish on a later run', () => {
  withTempDataDir((dataDir) => {
    // Run 1: Store A's Listing has no scientific name yet -- gets a trivial id.
    processStoreRun({
      store: storeA,
      rawData: rawProduct(50, 'Peugeot Tetra', '70.00'),
      dataDir,
      now: new Date('2026-11-18T00:00:00.000Z'),
    });
    const firstHistory = readHistoryFile(dataDir, 'cf:aquatic-arts:50') as CanonicalFishHistory;
    assert.equal(firstHistory.events.length, 1);

    // Run 2: the title now carries a scientific name (e.g. the Store
    // updated its copy) -- the Listing's canonicalFishId changes.
    processStoreRun({
      store: storeA,
      rawData: rawProduct(50, 'Peugeot Tetra (Hyphessobrycon peugeoti)', '74.99'),
      dataDir,
      now: new Date('2026-11-19T00:00:00.000Z'),
    });

    // The old history file is gone -- not left behind as an orphaned duplicate.
    assert.equal(readHistoryFile(dataDir, 'cf:aquatic-arts:50'), undefined);

    // Its full history (both events) now lives under the new, shared id.
    const newHistory = readHistoryFile(dataDir, 'cf:sci:hyphessobrycon-peugeoti') as CanonicalFishHistory;
    assert.equal(newHistory.events.length, 2);
    assert.equal(newHistory.events[0].price, 70.0);
    assert.equal(newHistory.events[1].price, 74.99);
  });
});
