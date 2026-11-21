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
      rawData: rawProduct(1, 'Cobalt Discus (Symphysodon aequifasciatus)', '80.00'),
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

test('issue #16: "Albino Cory" merges into one Canonical Fish across three real Stores despite mixed scientific-name extraction (vendor miscapitalization, a missed description pattern, and a correct extraction)', () => {
  withTempDataDir((dataDir) => {
    const storeAquariumFish: StoreConfig = { name: 'Aquarium Co-Op', slug: 'aquarium-fish', domain: 'aquariumcoop.com', platform: 'shopify' };
    const storeAquaHuna: StoreConfig = { name: 'AquaHuna', slug: 'aquahuna', domain: 'aquahuna.com', platform: 'shopify' };
    const storeCkFishWorld: StoreConfig = { name: 'CK Fish World', slug: 'ck-fish-world', domain: 'ckfishworld.com', platform: 'shopify' };

    // aquarium-fish: a correctly-cased "Scientific Name" label -> extracts cleanly.
    const aquariumFishRaw = rawProduct(1, 'Albino Cory', '3.00');
    (aquariumFishRaw.products[0] as { body_html: string }).body_html =
      'Quick Facts Scientific Name Corydoras aeneus (albino variety) Origin Captive-bred Care Level Easy, good for beginners.';
    processStoreRun({ store: storeAquariumFish, rawData: aquariumFishRaw, dataDir, now: new Date('2026-11-18T00:00:00.000Z') });

    // aquahuna: real-world description shape "Scientific Name: Corydoras
    // Aeneus From our tank..." -- vendor capitalized the species, so
    // extraction yields nothing and this Listing must fall back to fuzzy
    // common-name matching against aquarium-fish's "Albino Cory".
    const aquahunaRaw = rawProduct(2, 'Albino Cory', '4.00');
    (aquahunaRaw.products[0] as { body_html: string }).body_html =
      'Scientific Name: Corydoras Aeneus From our tank to your tank! We have mastered the art of keeping aquatic life.';
    processStoreRun({ store: storeAquaHuna, rawData: aquahunaRaw, dataDir, now: new Date('2026-11-18T00:00:01.000Z') });

    // ck-fish-world: a parenthetical binomial broken up by "var." -- the
    // extractor's parenthetical pattern doesn't match it either, so this
    // also falls back to fuzzy common-name matching.
    const ckRaw = rawProduct(3, 'Albino Cory', '5.00');
    (ckRaw.products[0] as { body_html: string }).body_html =
      'The Albino Corydora ( Corydoras aeneus var. albino ) is a small, peaceful freshwater catfish.';
    processStoreRun({ store: storeCkFishWorld, rawData: ckRaw, dataDir, now: new Date('2026-11-18T00:00:02.000Z') });

    const index = readIndexFile(dataDir);
    const a = index.listings.find((l) => l.listingId === 'aquarium-fish:1')!;
    const b = index.listings.find((l) => l.listingId === 'aquahuna:2')!;
    const c = index.listings.find((l) => l.listingId === 'ck-fish-world:3')!;

    // Issue #34: "Albino Cory" carries a detected "albino" variety, so
    // the shared id is suffixed accordingly -- this is the real-world
    // case issue #34 was filed about: the SAME id must not also be where
    // "Bronze Cory" or "Orange Venezuelan Cory" (other color morphs of
    // Corydoras aeneus) end up.
    assert.equal(a.canonicalFishId, 'cf:sci:corydoras-aeneus:albino');
    assert.equal(b.canonicalFishId, a.canonicalFishId);
    assert.equal(c.canonicalFishId, a.canonicalFishId);

    const history = readHistoryFile(dataDir, a.canonicalFishId) as CanonicalFishHistory;
    const storeSlugs = history.listings.map((l) => l.storeSlug).sort();
    assert.deepEqual(storeSlugs, ['aquahuna', 'aquarium-fish', 'ck-fish-world']);
  });
});

test('issue #34: "Albino Cory", "Bronze Cory", and "Orange Venezuelan Cory" are separate Canonical Fish entries despite sharing a species and generic wording', () => {
  withTempDataDir((dataDir) => {
    const storeAquaticArts: StoreConfig = { name: 'Aquatic Arts', slug: 'aquatic-arts', domain: 'aquaticarts.com', platform: 'shopify' };
    const storeAquaHuna: StoreConfig = { name: 'AquaHuna', slug: 'aquahuna', domain: 'aquahuna.com', platform: 'shopify' };
    const storeCkFishWorld: StoreConfig = { name: 'CK Fish World', slug: 'ck-fish-world', domain: 'ckfishworld.com', platform: 'shopify' };
    const storeAquariumFish: StoreConfig = { name: 'Aquarium Co-Op', slug: 'aquarium-fish', domain: 'aquariumcoop.com', platform: 'shopify' };

    // aquatic-arts: sci name present, "bronze" variety in the title.
    processStoreRun({
      store: storeAquaticArts,
      rawData: rawProduct(1, 'Bronze AKA Green Aeneus Cory Catfish (Corydoras aeneus), Tank-Bred', '4.00'),
      dataDir,
      now: new Date('2026-11-18T00:00:00.000Z'),
    });
    // aquahuna: no sci name, "albino" variety -- would have fuzzy-matched
    // the bare "cory"/"catfish" tokens against the bronze group above
    // before issue #34.
    processStoreRun({
      store: storeAquaHuna,
      rawData: rawProduct(2, 'Albino Cory', '4.00'),
      dataDir,
      now: new Date('2026-11-18T00:00:01.000Z'),
    });
    // ck-fish-world: no sci name, "orange" + "venezuelan" (unrecognized,
    // ignored) variety -- "orange" alone is enough to separate it from
    // both the bronze and albino groups.
    processStoreRun({
      store: storeCkFishWorld,
      rawData: rawProduct(3, 'Orange Venezuelan Cory', '5.00'),
      dataDir,
      now: new Date('2026-11-18T00:00:02.000Z'),
    });
    // aquarium-fish: a second, cross-store "Albino Cory" -- should still
    // join aquahuna's albino group, not the bronze or orange ones.
    processStoreRun({
      store: storeAquariumFish,
      rawData: rawProduct(4, 'Albino Cory', '3.00'),
      dataDir,
      now: new Date('2026-11-18T00:00:03.000Z'),
    });

    const index = readIndexFile(dataDir);
    const bronze = index.listings.find((l) => l.listingId === 'aquatic-arts:1')!;
    const albinoA = index.listings.find((l) => l.listingId === 'aquahuna:2')!;
    const orange = index.listings.find((l) => l.listingId === 'ck-fish-world:3')!;
    const albinoB = index.listings.find((l) => l.listingId === 'aquarium-fish:4')!;

    assert.equal(bronze.canonicalFishId, 'cf:sci:corydoras-aeneus:bronze-green');
    assert.equal(albinoA.canonicalFishId, albinoB.canonicalFishId);
    assert.notEqual(albinoA.canonicalFishId, bronze.canonicalFishId);
    assert.notEqual(orange.canonicalFishId, bronze.canonicalFishId);
    assert.notEqual(orange.canonicalFishId, albinoA.canonicalFishId);
  });
});

test('issue #34: "Platinum Medaka" and "Black Medaka" are separate Canonical Fish entries despite no extractable scientific name and a shared base noun', () => {
  withTempDataDir((dataDir) => {
    const storeDaku: StoreConfig = { name: 'Daku Aquatics', slug: 'daku-aquatics', domain: 'dakuaquatics.com', platform: 'shopify' };
    const storeCk: StoreConfig = { name: 'CK Fish World', slug: 'ck-fish-world', domain: 'ckfishworld.com', platform: 'shopify' };
    const storeNuAqua: StoreConfig = { name: 'Nu Aqua Shop', slug: 'nu-aqua-shop', domain: 'nuaquashop.com', platform: 'shopify' };

    // No scientific name anywhere -- pure fuzzy common-name matching, the
    // failure mode issue #34 reports as worse than the Corydoras case.
    processStoreRun({
      store: storeDaku,
      rawData: rawProduct(1, 'Black Medaka Ricefish', '6.00'),
      dataDir,
      now: new Date('2026-11-18T00:00:00.000Z'),
    });
    processStoreRun({
      store: storeCk,
      rawData: rawProduct(2, 'Platinum Japanese Ricefish', '6.50'),
      dataDir,
      now: new Date('2026-11-18T00:00:01.000Z'),
    });
    // A second "Black Medaka" from a different Store should still join
    // the first Black group, not the Platinum one.
    processStoreRun({
      store: storeNuAqua,
      rawData: rawProduct(3, 'Black Medaka Ricefish-L', '7.00'),
      dataDir,
      now: new Date('2026-11-18T00:00:02.000Z'),
    });

    const index = readIndexFile(dataDir);
    const blackA = index.listings.find((l) => l.listingId === 'daku-aquatics:1')!;
    const platinum = index.listings.find((l) => l.listingId === 'ck-fish-world:2')!;
    const blackB = index.listings.find((l) => l.listingId === 'nu-aqua-shop:3')!;

    assert.notEqual(blackA.canonicalFishId, platinum.canonicalFishId);
    assert.equal(blackA.canonicalFishId, blackB.canonicalFishId);
  });
});

test('issue #16: "Tail Spot Pygmy Cory" merges across two Stores despite a vendor-specific genus synonym ("Gastrodermus" vs "Corydoras")', () => {
  withTempDataDir((dataDir) => {
    const storeAquaticArts: StoreConfig = { name: 'Aquatic Arts', slug: 'aquatic-arts', domain: 'aquaticarts.com', platform: 'shopify' };
    const storeNationwide: StoreConfig = { name: 'Nationwide Aquatics USA', slug: 'nationwide-aquatics-usa', domain: 'nationwideaquaticsusa.com', platform: 'shopify' };

    processStoreRun({
      store: storeAquaticArts,
      rawData: rawProduct(1, 'Tail Spot Pygmy Cory (Corydoras hastatus) - Tank Bred', '6.00'),
      dataDir,
      now: new Date('2026-11-18T00:00:00.000Z'),
    });
    processStoreRun({
      store: storeNationwide,
      rawData: rawProduct(2, 'Tail Spot Pygmy Cory (Gastrodermus hastatus)', '7.00'),
      dataDir,
      now: new Date('2026-11-18T00:00:01.000Z'),
    });

    const index = readIndexFile(dataDir);
    const a = index.listings.find((l) => l.listingId === 'aquatic-arts:1')!;
    const b = index.listings.find((l) => l.listingId === 'nationwide-aquatics-usa:2')!;

    assert.equal(a.canonicalFishId, 'cf:sci:corydoras-hastatus');
    assert.equal(b.canonicalFishId, a.canonicalFishId);

    const history = readHistoryFile(dataDir, a.canonicalFishId) as CanonicalFishHistory;
    assert.equal(history.listings.length, 2);
  });
});

test('issue #16 regression: a cross-store-established scientific-name group is not hijacked by an unrelated corrupted rival sharing the same generic wording', () => {
  withTempDataDir((dataDir) => {
    const storeMonster: StoreConfig = { name: 'Monster Aquarium', slug: 'monster-aquarium', domain: 'monsteraquariumon9.com', platform: 'shopify' };
    const storeAquaHuna: StoreConfig = { name: 'AquaHuna', slug: 'aquahuna', domain: 'aquahuna.com', platform: 'shopify' };
    const storeAquaticArts: StoreConfig = { name: 'Aquatic Arts', slug: 'aquatic-arts', domain: 'aquaticarts.com', platform: 'shopify' };

    // monster-aquarium: clean title-parenthetical extraction establishes
    // the correct cf:sci:boraras-merah group first.
    processStoreRun({
      store: storeMonster,
      rawData: rawProduct(1, 'Phoenix Rasbora (Boraras merah)', '5.00'),
      dataDir,
      now: new Date('2026-11-18T00:00:00.000Z'),
    });

    // aquahuna: no scientific name extracted at all (bare title, no
    // description) -- falls back to fuzzy common-name matching and
    // establishes an unrelated, lower-fidelity group under its own
    // trivial id (no rival exists yet to merge into).
    processStoreRun({
      store: storeAquaHuna,
      rawData: rawProduct(2, 'Phoenix Rasbora', '6.00'),
      dataDir,
      now: new Date('2026-11-18T00:00:01.000Z'),
    });

    // aquatic-arts: also a clean title-parenthetical extraction for the
    // same species. Even though aquahuna's bare "Phoenix Rasbora" ties at
    // the same fuzzy score, this Listing's own cf:sci:boraras-merah id
    // already has cross-store corroboration (monster-aquarium) and must
    // win -- it must NOT be redirected onto aquahuna's trivial id.
    processStoreRun({
      store: storeAquaticArts,
      rawData: rawProduct(3, 'Phoenix Rasbora (Boraras merah)', '7.00'),
      dataDir,
      now: new Date('2026-11-18T00:00:02.000Z'),
    });

    const index = readIndexFile(dataDir);
    const monster = index.listings.find((l) => l.listingId === 'monster-aquarium:1')!;
    const arts = index.listings.find((l) => l.listingId === 'aquatic-arts:3')!;

    assert.equal(monster.canonicalFishId, 'cf:sci:boraras-merah');
    assert.equal(arts.canonicalFishId, 'cf:sci:boraras-merah');
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
