import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { migrateHeartbeatsInDataDir } from './migrate-heartbeats.js';
import type { CanonicalFishHistory } from '../types/listing.js';

function withTempDataDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(path.join(tmpdir(), 'track-fish-migrate-test-'));
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

test('compacts heartbeats into lastCheckedAt and strips them from events, leaving change events untouched', () => {
  withTempDataDir((dataDir) => {
    const history = {
      canonicalFishId: 'cf:sci:boraras-merah',
      commonName: 'Phoenix Rasbora',
      scientificName: 'Boraras merah',
      listings: [{ listingId: 'store-a:1', storeSlug: 'store-a', storeName: 'Store A', commonName: 'Phoenix Rasbora' }],
      events: [
        { type: 'change', observedAt: '2026-01-01T00:00:00.000Z', price: 5, currency: 'USD', available: true, variants: [], changedFields: ['first-observed'], listingId: 'store-a:1', storeSlug: 'store-a' },
        { type: 'heartbeat', observedAt: '2026-01-02T00:00:00.000Z', price: 5, currency: 'USD', available: true, variants: [], listingId: 'store-a:1', storeSlug: 'store-a' },
        { type: 'heartbeat', observedAt: '2026-01-03T00:00:00.000Z', price: 5, currency: 'USD', available: true, variants: [], listingId: 'store-a:1', storeSlug: 'store-a' },
        { type: 'change', observedAt: '2026-01-04T00:00:00.000Z', price: 6, currency: 'USD', available: true, variants: [], changedFields: ['price'], listingId: 'store-a:1', storeSlug: 'store-a' },
        { type: 'heartbeat', observedAt: '2026-01-05T00:00:00.000Z', price: 6, currency: 'USD', available: true, variants: [], listingId: 'store-a:1', storeSlug: 'store-a' },
      ],
    };
    writeRawHistory(dataDir, 'cf-sci-boraras-merah.json', history);

    const summary = migrateHeartbeatsInDataDir(dataDir);

    assert.equal(summary.filesScanned, 1);
    assert.equal(summary.filesChanged, 1);
    assert.equal(summary.totalHeartbeatsRemoved, 3);
    assert.ok(summary.totalBytesAfter < summary.totalBytesBefore);

    const migrated: CanonicalFishHistory = JSON.parse(
      readFileSync(path.join(dataDir, 'fish', 'cf-sci-boraras-merah.json'), 'utf-8')
    );
    assert.equal(migrated.events.length, 2);
    assert.deepEqual(migrated.events.map((e) => e.type), ['change', 'change']);
    assert.deepEqual(migrated.events.map((e) => e.changedFields), [['first-observed'], ['price']]);
    // Latest heartbeat's timestamp -- 2026-01-05 -- not the latest change's (2026-01-04).
    assert.equal(migrated.listings[0].lastCheckedAt, '2026-01-05T00:00:00.000Z');
  });
});

test('a Listing with no heartbeats at all falls back to its latest change event timestamp', () => {
  withTempDataDir((dataDir) => {
    const history = {
      canonicalFishId: 'cf:sci:x',
      commonName: 'Fish',
      scientificName: 'Genus speciesus',
      listings: [{ listingId: 'store-a:1', storeSlug: 'store-a', storeName: 'Store A', commonName: 'Fish' }],
      events: [
        { type: 'change', observedAt: '2026-01-01T00:00:00.000Z', price: 5, currency: 'USD', available: true, variants: [], changedFields: ['first-observed'], listingId: 'store-a:1', storeSlug: 'store-a' },
        { type: 'change', observedAt: '2026-01-02T00:00:00.000Z', price: 6, currency: 'USD', available: true, variants: [], changedFields: ['price'], listingId: 'store-a:1', storeSlug: 'store-a' },
      ],
    };
    writeRawHistory(dataDir, 'cf-sci-x.json', history);

    migrateHeartbeatsInDataDir(dataDir);

    const migrated: CanonicalFishHistory = JSON.parse(readFileSync(path.join(dataDir, 'fish', 'cf-sci-x.json'), 'utf-8'));
    assert.equal(migrated.events.length, 2);
    assert.equal(migrated.listings[0].lastCheckedAt, '2026-01-02T00:00:00.000Z');
  });
});

test('a file already migrated (no heartbeats, lastCheckedAt already set) is left byte-for-byte unchanged', () => {
  withTempDataDir((dataDir) => {
    const history: CanonicalFishHistory = {
      canonicalFishId: 'cf:sci:x',
      commonName: 'Fish',
      scientificName: 'Genus speciesus',
      listings: [
        { listingId: 'store-a:1', storeSlug: 'store-a', storeName: 'Store A', commonName: 'Fish', lastCheckedAt: '2026-01-02T00:00:00.000Z' },
      ],
      events: [
        {
          type: 'change',
          observedAt: '2026-01-01T00:00:00.000Z',
          price: 5,
          currency: 'USD',
          available: true,
          variants: [],
          changedFields: ['first-observed'],
          listingId: 'store-a:1',
          storeSlug: 'store-a',
        },
      ],
    };
    writeRawHistory(dataDir, 'cf-sci-x.json', history);

    const summary = migrateHeartbeatsInDataDir(dataDir);
    assert.equal(summary.filesChanged, 0);
    assert.equal(summary.totalHeartbeatsRemoved, 0);
  });
});

test('two Listings in one file: each gets its own independently-computed lastCheckedAt', () => {
  withTempDataDir((dataDir) => {
    const history = {
      canonicalFishId: 'cf:sci:x',
      commonName: 'Fish',
      scientificName: 'Genus speciesus',
      listings: [
        { listingId: 'store-a:1', storeSlug: 'store-a', storeName: 'Store A', commonName: 'Fish' },
        { listingId: 'store-b:1', storeSlug: 'store-b', storeName: 'Store B', commonName: 'Fish' },
      ],
      events: [
        { type: 'change', observedAt: '2026-01-01T00:00:00.000Z', price: 5, currency: 'USD', available: true, variants: [], changedFields: ['first-observed'], listingId: 'store-a:1', storeSlug: 'store-a' },
        { type: 'change', observedAt: '2026-01-01T00:00:00.000Z', price: 5, currency: 'USD', available: true, variants: [], changedFields: ['first-observed'], listingId: 'store-b:1', storeSlug: 'store-b' },
        { type: 'heartbeat', observedAt: '2026-01-02T00:00:00.000Z', price: 5, currency: 'USD', available: true, variants: [], listingId: 'store-a:1', storeSlug: 'store-a' },
        { type: 'heartbeat', observedAt: '2026-01-10T00:00:00.000Z', price: 5, currency: 'USD', available: true, variants: [], listingId: 'store-b:1', storeSlug: 'store-b' },
      ],
    };
    writeRawHistory(dataDir, 'cf-sci-x.json', history);

    migrateHeartbeatsInDataDir(dataDir);

    const migrated: CanonicalFishHistory = JSON.parse(readFileSync(path.join(dataDir, 'fish', 'cf-sci-x.json'), 'utf-8'));
    const a = migrated.listings.find((l) => l.listingId === 'store-a:1')!;
    const b = migrated.listings.find((l) => l.listingId === 'store-b:1')!;
    assert.equal(a.lastCheckedAt, '2026-01-02T00:00:00.000Z');
    assert.equal(b.lastCheckedAt, '2026-01-10T00:00:00.000Z');
  });
});
