import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { processStoreRun, type StoreConfig } from './process.js';
import { readIndexFile, readHistoryFile } from './lib/data-branch.js';
import type { CanonicalFishHistory } from './types/listing.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, 'lib/__fixtures__/shopify-sample.json');
const rawFixture = JSON.parse(readFileSync(fixturePath, 'utf-8'));

const store: StoreConfig = {
  name: 'Aquatic Arts',
  slug: 'aquatic-arts',
  domain: 'aquaticarts.com',
  platform: 'shopify',
};

function withTempDataDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(path.join(tmpdir(), 'track-fish-process-test-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function cloneRaw(): typeof rawFixture {
  return JSON.parse(JSON.stringify(rawFixture));
}

test('first run: every Listing is a Change Event tagged first-observed, index.json is populated', () => {
  withTempDataDir((dataDir) => {
    const result = processStoreRun({
      store,
      rawData: cloneRaw(),
      dataDir,
      now: new Date('2026-11-18T00:00:00.000Z'),
    });

    assert.equal(result.accepted, true);
    assert.equal(result.listingCount, 4);
    assert.equal(result.changeCount, 4);
    assert.equal(result.heartbeatCount, 0);

    const index = readIndexFile(dataDir);
    assert.equal(index.listings.length, 4);
    assert.equal(index.stores['aquatic-arts'].lastSuccessfulListingCount, 4);

    const guppy = index.listings.find((l) => l.productIdentifier === '15109197660527')!;
    assert.equal(guppy.firstObservedAt, '2026-11-18T00:00:00.000Z');
    assert.equal(guppy.lastObservedAt, '2026-11-18T00:00:00.000Z');

    const history = readHistoryFile(dataDir, guppy.canonicalFishId)!;
    assert.equal(history.events.length, 1);
    assert.equal(history.events[0].type, 'change');
    assert.deepEqual(history.events[0].changedFields, ['first-observed']);
  });
});

test('second run with no real-world change: every Listing emits a Heartbeat, firstObservedAt is preserved', () => {
  withTempDataDir((dataDir) => {
    processStoreRun({ store, rawData: cloneRaw(), dataDir, now: new Date('2026-11-18T00:00:00.000Z') });
    const second = processStoreRun({ store, rawData: cloneRaw(), dataDir, now: new Date('2026-11-19T00:00:00.000Z') });

    assert.equal(second.changeCount, 0);
    assert.equal(second.heartbeatCount, 4);

    const index = readIndexFile(dataDir);
    const guppy = index.listings.find((l) => l.productIdentifier === '15109197660527')!;
    assert.equal(guppy.firstObservedAt, '2026-11-18T00:00:00.000Z');
    assert.equal(guppy.lastObservedAt, '2026-11-19T00:00:00.000Z');

    const history = readHistoryFile(dataDir, guppy.canonicalFishId)!;
    assert.equal(history.events.length, 2);
    assert.equal(history.events[1].type, 'heartbeat');
  });
});

test('second run with a real price change and a restock: those Listings get Change Events, the rest get Heartbeats', () => {
  withTempDataDir((dataDir) => {
    processStoreRun({ store, rawData: cloneRaw(), dataDir, now: new Date('2026-11-18T00:00:00.000Z') });

    const changedRaw = cloneRaw();
    // Peugeot Tetra: price increase on its first variant.
    changedRaw.products[0].variants[0].price = '79.99';
    // Chinese Hillstream Loach: restocked.
    changedRaw.products[1].variants[0].available = true;

    const second = processStoreRun({ store, rawData: changedRaw, dataDir, now: new Date('2026-11-19T00:00:00.000Z') });

    assert.equal(second.changeCount, 2);
    assert.equal(second.heartbeatCount, 2);

    // "Peugeot Tetra (Hyphessobrycon peugeoti)" has an extractable
    // scientific name, so its Canonical Fish id is derived from that
    // (see issue #3 / src/lib/canonical-fish.ts), not from its own
    // productIdentifier.
    const tetraHistory = readHistoryFile(dataDir, 'cf:sci:hyphessobrycon-peugeoti') as CanonicalFishHistory;
    assert.equal(tetraHistory.events[1].type, 'change');
    // The variant price bump moves both the Listing-level price and the
    // variant itself, so both fields are flagged as changed.
    assert.deepEqual(tetraHistory.events[1].changedFields, ['price', 'variants']);
    assert.equal(tetraHistory.events[1].price, 79.99);

    const loachHistory = readHistoryFile(dataDir, 'cf:sci:pseudogastromyzon-myersi') as CanonicalFishHistory;
    assert.equal(loachHistory.events[1].type, 'change');
    // The loach has a single variant, so restocking it flips both the
    // Listing-level availability and that one variant's own state.
    assert.deepEqual(loachHistory.events[1].changedFields, ['available', 'variants']);
    assert.equal(loachHistory.events[1].available, true);

    // Unaffected listings got Heartbeats, not Change Events.
    const goodeidHistory = readHistoryFile(dataDir, 'cf:sci:ataeniobius-toweri') as CanonicalFishHistory;
    assert.equal(goodeidHistory.events[1].type, 'heartbeat');
  });
});

test('a Listing that vanishes from the catalog stays in index.json, unchanged, instead of being removed', () => {
  withTempDataDir((dataDir) => {
    processStoreRun({ store, rawData: cloneRaw(), dataDir, now: new Date('2026-11-18T00:00:00.000Z') });

    const shrunkRaw = cloneRaw();
    shrunkRaw.products = shrunkRaw.products.filter((p: { id: number }) => p.id !== 4741462790); // drop the loach, 4 -> 3 (25%, within tolerance)
    const result = processStoreRun({ store, rawData: shrunkRaw, dataDir, now: new Date('2026-11-19T00:00:00.000Z') });

    assert.equal(result.accepted, true);
    assert.equal(result.listingCount, 3);

    const index = readIndexFile(dataDir);
    assert.equal(index.listings.length, 4); // the vanished Listing is still here
    const loach = index.listings.find((l) => l.productIdentifier === '4741462790')!;
    assert.ok(loach, 'vanished Listing should remain in index.json');
    // Its lastObservedAt is stale -- from the run where it was last actually seen.
    assert.equal(loach.lastObservedAt, '2026-11-18T00:00:00.000Z');

    // No new history event was written for it (it was not observed this run).
    const history = readHistoryFile(dataDir, loach.canonicalFishId)!;
    assert.equal(history.events.length, 1);
  });
});

test('safety net rejects a run whose parsed Listing count drops more than 50%, and leaves prior state untouched', () => {
  withTempDataDir((dataDir) => {
    processStoreRun({ store, rawData: cloneRaw(), dataDir, now: new Date('2026-11-18T00:00:00.000Z') });

    const shrunkRaw = { products: rawFixture.products.slice(0, 1) }; // 4 -> 1, a 75% drop
    const result = processStoreRun({ store, rawData: shrunkRaw, dataDir, now: new Date('2026-11-19T00:00:00.000Z') });

    assert.equal(result.accepted, false);
    assert.match(result.rejectionReason ?? '', /50%/);

    // index.json must be untouched by the rejected run.
    const index = readIndexFile(dataDir);
    assert.equal(index.listings.length, 4);
    assert.equal(index.stores['aquatic-arts'].lastSuccessfulListingCount, 4);
  });
});
