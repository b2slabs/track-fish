import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { dedupeSpuriousFirstObservedInDataDir } from './migrate-dedupe-first-observed.js';
import type { CanonicalFishHistory } from '../types/listing.js';

/**
 * One-time migration for issue #96: `process.ts`'s same-Store merge
 * (issue #56) diffed a merged Listing against its prior state by looking
 * it up ONLY under its exact merged `listingId` -- so whenever a merge
 * group's *composition* changed between runs (a sibling product
 * appearing/disappearing), that lookup missed, and `diffListing` treated
 * an already-long-tracked Listing as brand new, writing a second (or
 * third, ...) spurious `'first-observed'` Change Event into its history.
 * The live bug is fixed in `process.ts` (the lookup now falls back to
 * `previousListingsByProductId`, same as `priorFirstObservedAt` already
 * did) -- this migration cleans up every already-published history file
 * still carrying those extra, spurious `'first-observed'` entries from
 * before that fix landed.
 */

function withTempDataDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(path.join(tmpdir(), 'track-fish-dedupe-fo-test-'));
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

test('drops a later spurious first-observed event only when it carries no real price/availability/variant change since the last kept state', () => {
  withTempDataDir((dataDir) => {
    const history = {
      canonicalFishId: 'cf:sci:corydoras-panda:panda',
      commonName: 'Panda Cory',
      scientificName: 'Corydoras panda',
      listings: [
        { listingId: 'aquarium-fish:10130832032043+6319067974', storeSlug: 'aquarium-fish', storeName: 'AquariumFish.com', commonName: 'Panda Cory', lastCheckedAt: '2026-11-22T16:57:23.666Z' },
      ],
      events: [
        { type: 'change', observedAt: '2026-01-08T21:00:00.000Z', price: 24.37, currency: 'USD', available: true, variants: [], changedFields: ['first-observed'], listingId: 'aquarium-fish:10130832032043', storeSlug: 'aquarium-fish' },
        // Anchor: this compound listingId's true first appearance.
        { type: 'change', observedAt: '2026-11-20T06:27:42.901Z', price: 17.99, currency: 'USD', available: true, variants: [], changedFields: ['first-observed'], listingId: 'aquarium-fish:10130832032043+6319067974', storeSlug: 'aquarium-fish' },
        // Duplicate first-observed, but the price genuinely differs from the
        // anchor -- real information, must survive (relabeled, not dropped).
        { type: 'change', observedAt: '2026-11-20T06:27:42.901Z', price: 6.29, currency: 'USD', available: true, variants: [], changedFields: ['first-observed'], listingId: 'aquarium-fish:10130832032043+6319067974', storeSlug: 'aquarium-fish' },
        // Duplicate first-observed, identical to the immediately preceding
        // kept state -- genuinely spurious, safe to drop.
        { type: 'change', observedAt: '2026-11-21T20:08:06.000Z', price: 6.29, currency: 'USD', available: true, variants: [], changedFields: ['first-observed'], listingId: 'aquarium-fish:10130832032043+6319067974', storeSlug: 'aquarium-fish' },
      ],
    };
    writeRawHistory(dataDir, 'cf-sci-corydoras-panda-panda.json', history);

    const summary = dedupeSpuriousFirstObservedInDataDir(dataDir);

    assert.equal(summary.filesScanned, 1);
    assert.equal(summary.filesChanged, 1);
    assert.equal(summary.totalSpuriousEventsRemoved, 1);

    const migrated: CanonicalFishHistory = JSON.parse(
      readFileSync(path.join(dataDir, 'fish', 'cf-sci-corydoras-panda-panda.json'), 'utf-8'),
    );
    // The genuinely distinct listingId's own first-observed is untouched.
    assert.ok(migrated.events.some((e) => e.listingId === 'aquarium-fish:10130832032043' && e.observedAt === '2026-01-08T21:00:00.000Z'));
    const compoundEvents = migrated.events.filter((e) => e.listingId === 'aquarium-fish:10130832032043+6319067974');
    assert.equal(compoundEvents.length, 2);
    assert.equal(compoundEvents[0].observedAt, '2026-11-20T06:27:42.901Z');
    assert.equal(compoundEvents[0].price, 17.99);
    assert.deepEqual(compoundEvents[0].changedFields, ['first-observed']);
    // The real price change survives, relabeled as a genuine price change
    // instead of a second "first-observed".
    assert.equal(compoundEvents[1].price, 6.29);
    assert.deepEqual(compoundEvents[1].changedFields, ['price']);
  });
});

test('regression (user-reported): a restock mislabeled as a duplicate first-observed is kept and relabeled, not deleted', () => {
  withTempDataDir((dataDir) => {
    const history = {
      canonicalFishId: 'cf:sci:yaoshania-pachychilus-from:panda',
      commonName: 'Panda Loach',
      scientificName: 'Yaoshania pachychilus',
      listings: [
        { listingId: 'aquahuna:6835283099723', storeSlug: 'aquahuna', storeName: 'AquaHuna', commonName: 'Panda Loach', lastCheckedAt: '2026-11-25T19:01:24.783Z' },
      ],
      events: [
        { type: 'change', observedAt: '2026-01-08T21:00:00.000Z', price: 13.5, currency: 'USD', available: false, variants: [{ id: 'v1', label: 'Title', price: 13.5, available: false }], changedFields: ['first-observed'], listingId: 'aquahuna:6835283099723', storeSlug: 'aquahuna' },
        { type: 'change', observedAt: '2026-02-13T03:00:00.000Z', price: 13.5, currency: 'USD', available: true, variants: [{ id: 'v1', label: 'Title', price: 13.5, available: true }], changedFields: ['available', 'variants'], listingId: 'aquahuna:6835283099723', storeSlug: 'aquahuna' },
        { type: 'change', observedAt: '2026-02-15T03:00:00.000Z', price: 13.5, currency: 'USD', available: false, variants: [{ id: 'v1', label: 'Title', price: 13.5, available: false }], changedFields: ['available', 'variants'], listingId: 'aquahuna:6835283099723', storeSlug: 'aquahuna' },
        // The same-Store-merge composition-churn bug (issue #96) mislabeled
        // this genuine restock as a second "first-observed" instead of an
        // 'available'/'variants' change.
        { type: 'change', observedAt: '2026-11-20T06:14:42.593Z', price: 13.5, currency: 'USD', available: true, variants: [{ id: 'v1', label: 'Title', price: 13.5, available: true }], changedFields: ['first-observed'], listingId: 'aquahuna:6835283099723', storeSlug: 'aquahuna' },
      ],
    };
    writeRawHistory(dataDir, 'cf-sci-yaoshania-pachychilus-from-panda.json', history);

    const summary = dedupeSpuriousFirstObservedInDataDir(dataDir);

    // Nothing was spurious here -- every event reflects a real state change,
    // so nothing is REMOVED, but the file still changes on disk since the
    // mislabeled event's changedFields gets corrected.
    assert.equal(summary.filesChanged, 1);
    assert.equal(summary.totalSpuriousEventsRemoved, 0);

    const migrated: CanonicalFishHistory = JSON.parse(
      readFileSync(path.join(dataDir, 'fish', 'cf-sci-yaoshania-pachychilus-from-panda.json'), 'utf-8'),
    );
    assert.equal(migrated.events.length, 4);
    const nov20 = migrated.events.find((e) => e.observedAt === '2026-11-20T06:14:42.593Z')!;
    assert.ok(nov20, 'the restock event must survive');
    assert.equal(nov20.available, true);
    assert.deepEqual(nov20.changedFields, ['available', 'variants']);
  });
});

test('a listingId with exactly one first-observed event is left untouched', () => {
  withTempDataDir((dataDir) => {
    const history: CanonicalFishHistory = {
      canonicalFishId: 'cf:sci:x',
      commonName: 'Fish',
      scientificName: 'Genus speciesus',
      listings: [{ listingId: 'store-a:1', storeSlug: 'store-a', storeName: 'Store A', commonName: 'Fish', lastCheckedAt: '2026-01-02T00:00:00.000Z' }],
      events: [
        { type: 'change', observedAt: '2026-01-01T00:00:00.000Z', price: 5, currency: 'USD', available: true, variants: [], changedFields: ['first-observed'], listingId: 'store-a:1', storeSlug: 'store-a' },
        { type: 'change', observedAt: '2026-01-02T00:00:00.000Z', price: 6, currency: 'USD', available: true, variants: [], changedFields: ['price'], listingId: 'store-a:1', storeSlug: 'store-a' },
      ],
    };
    writeRawHistory(dataDir, 'cf-sci-x.json', history);

    const summary = dedupeSpuriousFirstObservedInDataDir(dataDir);

    assert.equal(summary.filesChanged, 0);
    assert.equal(summary.totalSpuriousEventsRemoved, 0);
    const migrated: CanonicalFishHistory = JSON.parse(readFileSync(path.join(dataDir, 'fish', 'cf-sci-x.json'), 'utf-8'));
    assert.equal(migrated.events.length, 2);
  });
});

test('is idempotent: running it twice produces the same result the second time with nothing left to remove', () => {
  withTempDataDir((dataDir) => {
    const history = {
      canonicalFishId: 'cf:sci:x',
      commonName: 'Fish',
      scientificName: 'Genus speciesus',
      listings: [{ listingId: 'store-a:1+2', storeSlug: 'store-a', storeName: 'Store A', commonName: 'Fish', lastCheckedAt: '2026-01-05T00:00:00.000Z' }],
      events: [
        { type: 'change', observedAt: '2026-01-01T00:00:00.000Z', price: 5, currency: 'USD', available: true, variants: [], changedFields: ['first-observed'], listingId: 'store-a:1+2', storeSlug: 'store-a' },
        { type: 'change', observedAt: '2026-01-03T00:00:00.000Z', price: 5, currency: 'USD', available: true, variants: [], changedFields: ['first-observed'], listingId: 'store-a:1+2', storeSlug: 'store-a' },
      ],
    };
    writeRawHistory(dataDir, 'cf-sci-x.json', history);

    const first = dedupeSpuriousFirstObservedInDataDir(dataDir);
    assert.equal(first.totalSpuriousEventsRemoved, 1);

    const second = dedupeSpuriousFirstObservedInDataDir(dataDir);
    assert.equal(second.filesChanged, 0);
    assert.equal(second.totalSpuriousEventsRemoved, 0);
  });
});
