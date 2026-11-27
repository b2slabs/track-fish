import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { canonicalizeGenusSynonymFishId, mergeGenusSynonymFishInDataDir } from './migrate-genus-synonym-merge.js';
import type { CanonicalFishHistory, IndexFile } from '../types/listing.js';

/**
 * One-time migration for issue #114: issue #90 added `GENUS_SYNONYMS` so a
 * *newly-matched* Listing under a reclassified genus (e.g. Hoplisoma /
 * Gastrodermus, folded back into Corydoras) converges on the same
 * `cf:sci:` slug as its Corydoras-genus counterpart. It did not
 * retroactively re-bucket Listings already filed under the old genus's
 * slug before that fix shipped. This migration finds every already-
 * published fish history file still stuck under a synonym genus and
 * merges it into its canonical counterpart (or renames it, if no
 * canonical counterpart exists yet).
 */

function withTempDataDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(path.join(tmpdir(), 'track-fish-genus-synonym-test-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeRawHistory(dataDir: string, fileName: string, history: unknown): void {
  const fishDir = path.join(dataDir, 'fish');
  mkdirSync(fishDir, { recursive: true });
  writeFileSync(path.join(fishDir, fileName), JSON.stringify(history, null, 2) + '\n');
}

function readHistory(dataDir: string, fileName: string): CanonicalFishHistory {
  return JSON.parse(readFileSync(path.join(dataDir, 'fish', fileName), 'utf-8'));
}

function writeIndex(dataDir: string, index: IndexFile): void {
  writeFileSync(path.join(dataDir, 'index.json'), JSON.stringify(index, null, 2) + '\n');
}

function readIndex(dataDir: string): IndexFile {
  return JSON.parse(readFileSync(path.join(dataDir, 'index.json'), 'utf-8'));
}

// --- canonicalizeGenusSynonymFishId -------------------------------------

test('canonicalizeGenusSynonymFishId rewrites a synonym genus to its canonical genus', () => {
  assert.equal(canonicalizeGenusSynonymFishId('cf:sci:gastrodermus-hastatus'), 'cf:sci:corydoras-hastatus');
  assert.equal(canonicalizeGenusSynonymFishId('cf:sci:hoplisoma-adolfoi'), 'cf:sci:corydoras-adolfoi');
});

test('canonicalizeGenusSynonymFishId preserves a variety suffix', () => {
  assert.equal(canonicalizeGenusSynonymFishId('cf:sci:hoplisoma-panda:panda'), 'cf:sci:corydoras-panda:panda');
});

test('canonicalizeGenusSynonymFishId leaves a genus with no registered synonym untouched', () => {
  assert.equal(canonicalizeGenusSynonymFishId('cf:sci:corydoras-hastatus'), 'cf:sci:corydoras-hastatus');
});

test('canonicalizeGenusSynonymFishId leaves a non-scientific-name id untouched', () => {
  assert.equal(canonicalizeGenusSynonymFishId('cf:nu-aqua-shop:10006360686908'), 'cf:nu-aqua-shop:10006360686908');
});

// --- mergeGenusSynonymFishInDataDir --------------------------------------

test('a two-file merge: the synonym-genus file is merged into its existing canonical file, losing no listing or event', () => {
  withTempDataDir((dataDir) => {
    const oldHistory: CanonicalFishHistory = {
      canonicalFishId: 'cf:sci:gastrodermus-hastatus',
      commonName: 'Tail Spot Pygmy Cory',
      scientificName: 'Gastrodermus hastatus',
      listings: [
        { listingId: 'nu-aqua-shop:1', storeSlug: 'nu-aqua-shop', storeName: 'NU Aqua Shop', commonName: 'Tail Spot Pygmy Cory', lastCheckedAt: '2026-11-27T04:00:00.000Z' },
      ],
      events: [
        { type: 'change', observedAt: '2026-11-21T00:00:00.000Z', price: 19.99, currency: 'USD', available: true, variants: [], changedFields: ['first-observed'], listingId: 'nu-aqua-shop:1', storeSlug: 'nu-aqua-shop' },
      ],
    };
    const canonicalHistory: CanonicalFishHistory = {
      canonicalFishId: 'cf:sci:corydoras-hastatus',
      commonName: 'Corydoras hastatus',
      scientificName: 'Corydoras hastatus',
      listings: [
        { listingId: 'dans-fish:2', storeSlug: 'dans-fish', storeName: "Dan's Fish", commonName: 'Corydoras hastatus', lastCheckedAt: '2026-11-27T04:00:00.000Z' },
      ],
      events: [
        { type: 'change', observedAt: '2026-11-20T00:00:00.000Z', price: 14.99, currency: 'USD', available: true, variants: [], changedFields: ['first-observed'], listingId: 'dans-fish:2', storeSlug: 'dans-fish' },
      ],
    };
    writeRawHistory(dataDir, 'cf-sci-gastrodermus-hastatus.json', oldHistory);
    writeRawHistory(dataDir, 'cf-sci-corydoras-hastatus.json', canonicalHistory);
    writeIndex(dataDir, {
      generatedAt: '2026-11-27T04:00:00.000Z',
      stores: {},
      listings: [
        { listingId: 'nu-aqua-shop:1', storeSlug: 'nu-aqua-shop', storeName: 'NU Aqua Shop', canonicalFishId: 'cf:sci:gastrodermus-hastatus', scientificName: 'Gastrodermus hastatus', commonName: 'Tail Spot Pygmy Cory', description: '', productUrl: '', imageUrl: null, currency: 'USD', price: 19.99, available: true, variants: [], firstObservedAt: '2026-11-21T00:00:00.000Z', lastObservedAt: '2026-11-27T04:00:00.000Z' } as any,
        { listingId: 'dans-fish:2', storeSlug: 'dans-fish', storeName: "Dan's Fish", canonicalFishId: 'cf:sci:corydoras-hastatus', scientificName: 'Corydoras hastatus', commonName: 'Corydoras hastatus', description: '', productUrl: '', imageUrl: null, currency: 'USD', price: 14.99, available: true, variants: [], firstObservedAt: '2026-11-20T00:00:00.000Z', lastObservedAt: '2026-11-27T04:00:00.000Z' } as any,
      ],
    });

    const summary = mergeGenusSynonymFishInDataDir(dataDir);

    assert.equal(summary.filesAffected, 1);
    assert.equal(summary.perFile[0].mergedIntoExisting, true);
    assert.equal(summary.perFile[0].listingsMoved, 1);
    assert.equal(summary.perFile[0].eventsMoved, 1);

    // Old file is gone.
    assert.equal(existsSync(path.join(dataDir, 'fish', 'cf-sci-gastrodermus-hastatus.json')), false);

    const merged = readHistory(dataDir, 'cf-sci-corydoras-hastatus.json');
    assert.equal(merged.canonicalFishId, 'cf:sci:corydoras-hastatus');
    assert.equal(merged.listings.length, 2);
    assert.equal(merged.events.length, 2);
    assert.ok(merged.listings.some((l) => l.listingId === 'nu-aqua-shop:1'));
    assert.ok(merged.listings.some((l) => l.listingId === 'dans-fish:2'));
    assert.ok(merged.events.some((e) => e.listingId === 'nu-aqua-shop:1' && e.price === 19.99));
    assert.ok(merged.events.some((e) => e.listingId === 'dans-fish:2' && e.price === 14.99));

    const index = readIndex(dataDir);
    const movedListing = index.listings.find((l) => l.listingId === 'nu-aqua-shop:1')!;
    assert.equal(movedListing.canonicalFishId, 'cf:sci:corydoras-hastatus');
    const untouchedListing = index.listings.find((l) => l.listingId === 'dans-fish:2')!;
    assert.equal(untouchedListing.canonicalFishId, 'cf:sci:corydoras-hastatus');
    assert.equal(summary.listingsUpdatedInIndex, 1);
  });
});

test('a rename case: the synonym-genus file is the only one under that species -- no canonical file exists yet, so it is re-keyed in place with all listings/events intact', () => {
  withTempDataDir((dataDir) => {
    const onlyHistory: CanonicalFishHistory = {
      canonicalFishId: 'cf:sci:hoplisoma-colossus',
      commonName: 'Colossus Cory',
      scientificName: 'Hoplisoma colossus',
      listings: [
        { listingId: 'aqua-imports:1', storeSlug: 'aqua-imports', storeName: 'Aqua Imports', commonName: 'Colossus Cory', lastCheckedAt: '2026-11-27T04:00:00.000Z' },
        { listingId: 'nationwide-aquatics-usa:2', storeSlug: 'nationwide-aquatics-usa', storeName: 'Nationwide Aquatics USA', commonName: 'Colossus Cory', lastCheckedAt: '2026-11-27T04:00:00.000Z' },
      ],
      events: [
        { type: 'change', observedAt: '2026-11-20T00:00:00.000Z', price: 29.99, currency: 'USD', available: true, variants: [], changedFields: ['first-observed'], listingId: 'aqua-imports:1', storeSlug: 'aqua-imports' },
        { type: 'change', observedAt: '2026-11-21T00:00:00.000Z', price: 24.99, currency: 'USD', available: true, variants: [], changedFields: ['first-observed'], listingId: 'nationwide-aquatics-usa:2', storeSlug: 'nationwide-aquatics-usa' },
      ],
    };
    writeRawHistory(dataDir, 'cf-sci-hoplisoma-colossus.json', onlyHistory);
    writeIndex(dataDir, {
      generatedAt: '2026-11-27T04:00:00.000Z',
      stores: {},
      listings: [
        { listingId: 'aqua-imports:1', storeSlug: 'aqua-imports', storeName: 'Aqua Imports', canonicalFishId: 'cf:sci:hoplisoma-colossus', scientificName: 'Hoplisoma colossus', commonName: 'Colossus Cory', description: '', productUrl: '', imageUrl: null, currency: 'USD', price: 29.99, available: true, variants: [], firstObservedAt: '2026-11-20T00:00:00.000Z', lastObservedAt: '2026-11-27T04:00:00.000Z' } as any,
        { listingId: 'nationwide-aquatics-usa:2', storeSlug: 'nationwide-aquatics-usa', storeName: 'Nationwide Aquatics USA', canonicalFishId: 'cf:sci:hoplisoma-colossus', scientificName: 'Hoplisoma colossus', commonName: 'Colossus Cory', description: '', productUrl: '', imageUrl: null, currency: 'USD', price: 24.99, available: true, variants: [], firstObservedAt: '2026-11-21T00:00:00.000Z', lastObservedAt: '2026-11-27T04:00:00.000Z' } as any,
      ],
    });

    const summary = mergeGenusSynonymFishInDataDir(dataDir);

    assert.equal(summary.filesAffected, 1);
    assert.equal(summary.perFile[0].mergedIntoExisting, false);
    assert.equal(summary.perFile[0].listingsMoved, 2);
    assert.equal(summary.perFile[0].eventsMoved, 2);

    assert.equal(existsSync(path.join(dataDir, 'fish', 'cf-sci-hoplisoma-colossus.json')), false);
    const renamed = readHistory(dataDir, 'cf-sci-corydoras-colossus.json');
    assert.equal(renamed.canonicalFishId, 'cf:sci:corydoras-colossus');
    assert.equal(renamed.scientificName, 'Hoplisoma colossus');
    assert.equal(renamed.listings.length, 2);
    assert.equal(renamed.events.length, 2);
    assert.ok(renamed.events.some((e) => e.price === 29.99));
    assert.ok(renamed.events.some((e) => e.price === 24.99));

    const index = readIndex(dataDir);
    assert.ok(index.listings.every((l) => l.canonicalFishId === 'cf:sci:corydoras-colossus'));
    assert.equal(summary.listingsUpdatedInIndex, 2);
  });
});

test('a file with no events worth losing: only listings, zero events -- the merge keeps zero at zero, not dropping or inventing any', () => {
  withTempDataDir((dataDir) => {
    const oldHistory: CanonicalFishHistory = {
      canonicalFishId: 'cf:sci:gastrodermus-elegans',
      commonName: 'Elegant Cory',
      scientificName: 'Gastrodermus elegans',
      listings: [
        { listingId: 'dans-fish:3', storeSlug: 'dans-fish', storeName: "Dan's Fish", commonName: 'Elegant Cory', lastCheckedAt: '2026-11-27T04:00:00.000Z' },
      ],
      events: [],
    };
    const canonicalHistory: CanonicalFishHistory = {
      canonicalFishId: 'cf:sci:corydoras-elegans',
      commonName: 'Corydoras elegans',
      scientificName: 'Corydoras elegans',
      listings: [
        { listingId: 'aquarium-fish:4', storeSlug: 'aquarium-fish', storeName: 'AquariumFish.com', commonName: 'Corydoras elegans', lastCheckedAt: '2026-11-27T04:00:00.000Z' },
      ],
      events: [
        { type: 'change', observedAt: '2026-11-19T00:00:00.000Z', price: 9.99, currency: 'USD', available: true, variants: [], changedFields: ['first-observed'], listingId: 'aquarium-fish:4', storeSlug: 'aquarium-fish' },
      ],
    };
    writeRawHistory(dataDir, 'cf-sci-gastrodermus-elegans.json', oldHistory);
    writeRawHistory(dataDir, 'cf-sci-corydoras-elegans.json', canonicalHistory);
    writeIndex(dataDir, {
      generatedAt: '2026-11-27T04:00:00.000Z',
      stores: {},
      listings: [
        { listingId: 'dans-fish:3', storeSlug: 'dans-fish', storeName: "Dan's Fish", canonicalFishId: 'cf:sci:gastrodermus-elegans', scientificName: 'Gastrodermus elegans', commonName: 'Elegant Cory', description: '', productUrl: '', imageUrl: null, currency: 'USD', price: 9.99, available: true, variants: [], firstObservedAt: '2026-11-27T04:00:00.000Z', lastObservedAt: '2026-11-27T04:00:00.000Z' } as any,
        { listingId: 'aquarium-fish:4', storeSlug: 'aquarium-fish', storeName: 'AquariumFish.com', canonicalFishId: 'cf:sci:corydoras-elegans', scientificName: 'Corydoras elegans', commonName: 'Corydoras elegans', description: '', productUrl: '', imageUrl: null, currency: 'USD', price: 9.99, available: true, variants: [], firstObservedAt: '2026-11-19T00:00:00.000Z', lastObservedAt: '2026-11-27T04:00:00.000Z' } as any,
      ],
    });

    const summary = mergeGenusSynonymFishInDataDir(dataDir);

    assert.equal(summary.perFile[0].eventsMoved, 0);
    const merged = readHistory(dataDir, 'cf-sci-corydoras-elegans.json');
    assert.equal(merged.listings.length, 2);
    // No events existed on the old side, so the target's event count is
    // unchanged from before the merge -- nothing lost, nothing invented.
    assert.equal(merged.events.length, 1);
    assert.ok(merged.listings.some((l) => l.listingId === 'dans-fish:3'));
  });
});

test('idempotency: running the migration twice is a no-op the second time', () => {
  withTempDataDir((dataDir) => {
    const oldHistory: CanonicalFishHistory = {
      canonicalFishId: 'cf:sci:gastrodermus-hastatus',
      commonName: 'Tail Spot Pygmy Cory',
      scientificName: 'Gastrodermus hastatus',
      listings: [
        { listingId: 'nu-aqua-shop:1', storeSlug: 'nu-aqua-shop', storeName: 'NU Aqua Shop', commonName: 'Tail Spot Pygmy Cory', lastCheckedAt: '2026-11-27T04:00:00.000Z' },
      ],
      events: [
        { type: 'change', observedAt: '2026-11-21T00:00:00.000Z', price: 19.99, currency: 'USD', available: true, variants: [], changedFields: ['first-observed'], listingId: 'nu-aqua-shop:1', storeSlug: 'nu-aqua-shop' },
      ],
    };
    writeRawHistory(dataDir, 'cf-sci-gastrodermus-hastatus.json', oldHistory);
    writeIndex(dataDir, {
      generatedAt: '2026-11-27T04:00:00.000Z',
      stores: {},
      listings: [
        { listingId: 'nu-aqua-shop:1', storeSlug: 'nu-aqua-shop', storeName: 'NU Aqua Shop', canonicalFishId: 'cf:sci:gastrodermus-hastatus', scientificName: 'Gastrodermus hastatus', commonName: 'Tail Spot Pygmy Cory', description: '', productUrl: '', imageUrl: null, currency: 'USD', price: 19.99, available: true, variants: [], firstObservedAt: '2026-11-21T00:00:00.000Z', lastObservedAt: '2026-11-27T04:00:00.000Z' } as any,
      ],
    });

    const first = mergeGenusSynonymFishInDataDir(dataDir);
    assert.equal(first.filesAffected, 1);

    const afterFirstRunFish = readFileSync(path.join(dataDir, 'fish', 'cf-sci-corydoras-hastatus.json'), 'utf-8');
    const afterFirstRunIndex = readFileSync(path.join(dataDir, 'index.json'), 'utf-8');

    const second = mergeGenusSynonymFishInDataDir(dataDir);
    assert.equal(second.filesAffected, 0);
    assert.equal(second.listingsUpdatedInIndex, 0);

    // Byte-for-byte unchanged on the second pass.
    assert.equal(readFileSync(path.join(dataDir, 'fish', 'cf-sci-corydoras-hastatus.json'), 'utf-8'), afterFirstRunFish);
    assert.equal(readFileSync(path.join(dataDir, 'index.json'), 'utf-8'), afterFirstRunIndex);
  });
});
