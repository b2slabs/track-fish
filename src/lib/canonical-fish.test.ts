import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMatchContext,
  matchCanonicalFish,
  removeListingFromHistory,
  mergeListingIntoHistory,
  migrateLegacyHistory,
  isLegacyHistory,
} from './canonical-fish.js';
import type { CanonicalFishHistory, CanonicalFishHistoryEvent, CanonicalFishHistoryListing } from '../types/listing.js';

function existingListing(overrides: Partial<{ canonicalFishId: string; storeSlug: string; commonName: string }>) {
  return { canonicalFishId: 'cf:x', storeSlug: 'store-a', commonName: 'Fish', ...overrides };
}

test('two Listings from different Stores with the same scientific name get the same Canonical Fish id', () => {
  const contextA = buildMatchContext('aquatic-arts', [], []);
  const contextB = buildMatchContext('monster-aquarium', [], []);

  const a = matchCanonicalFish(
    { productIdentifier: '1', commonName: 'Cobalt Discus (Symphysodon aequifasciatus)', description: '' },
    contextA
  );
  const b = matchCanonicalFish(
    { productIdentifier: '2', commonName: "Dealer's Choice Discus (Symphysodon aequifasciatus)", description: '' },
    contextB
  );

  assert.equal(a.status, 'scientific-name');
  assert.equal(b.status, 'scientific-name');
  assert.equal(a.canonicalFishId, b.canonicalFishId);
  assert.equal(a.canonicalFishId, 'cf:sci:symphysodon-aequifasciatus');
});

test('a maintainer override always wins, even over a scientific-name match', () => {
  const context = buildMatchContext('aquatic-arts', [], [
    { listingId: 'aquatic-arts:1', canonicalFishId: 'cf:manual:something-else' },
  ]);
  const result = matchCanonicalFish(
    { productIdentifier: '1', commonName: 'Fish (Genus speciesus)', description: '' },
    context
  );
  assert.equal(result.status, 'override');
  assert.equal(result.canonicalFishId, 'cf:manual:something-else');
});

test('a confident fuzzy common-name match against a different Store auto-merges', () => {
  const context = buildMatchContext('monster-aquarium', [
    existingListing({ canonicalFishId: 'cf:aquatic-arts:9', storeSlug: 'aquatic-arts', commonName: 'Blue Tail Goodeid' }),
  ], []);
  const result = matchCanonicalFish(
    { productIdentifier: '1', commonName: 'Blue-Tail Goodeid', description: '' },
    context
  );
  assert.equal(result.status, 'fuzzy-auto');
  assert.equal(result.canonicalFishId, 'cf:aquatic-arts:9');
});

test('a mid-confidence fuzzy match is ambiguous, not auto-merged', () => {
  const context = buildMatchContext('monster-aquarium', [
    existingListing({ canonicalFishId: 'cf:aquatic-arts:9', storeSlug: 'aquatic-arts', commonName: 'Blue Cobalt Discus' }),
  ], []);
  const result = matchCanonicalFish(
    { productIdentifier: '1', commonName: 'Blue Diamond Discus', description: '' },
    context
  );
  assert.equal(result.status, 'ambiguous');
  assert.equal(result.canonicalFishId, 'cf:monster-aquarium:1'); // stays on its own trivial id
  assert.equal(result.ambiguousCandidate?.canonicalFishId, 'cf:aquatic-arts:9');
});

test('fuzzy matching ignores candidates whose only Listings are from the same Store', () => {
  const context = buildMatchContext('aquatic-arts', [
    existingListing({ canonicalFishId: 'cf:aquatic-arts:9', storeSlug: 'aquatic-arts', commonName: 'Blue Tail Goodeid' }),
  ], []);
  const result = matchCanonicalFish(
    { productIdentifier: '1', commonName: 'Blue-Tail Goodeid', description: '' },
    context
  );
  // No cross-store candidate exists, so this should NOT fuzzy-merge into
  // the other aquatic-arts Listing even though the wording is near-identical.
  assert.notEqual(result.status, 'fuzzy-auto');
  assert.equal(result.canonicalFishId, 'cf:aquatic-arts:1');
});

test('issue #16: a confident fuzzy common-name match reconciles two different extracted scientific names (vendor synonym) into the already-established group', () => {
  const context = buildMatchContext('nationwide-aquatics-usa', [
    existingListing({
      canonicalFishId: 'cf:sci:corydoras-hastatus',
      storeSlug: 'aquatic-arts',
      commonName: 'Tail Spot Pygmy Cory (Corydoras hastatus) - Tank Bred',
    }),
  ], []);
  const result = matchCanonicalFish(
    { productIdentifier: '1', commonName: 'Tail Spot Pygmy Cory (Gastrodermus hastatus)', description: '' },
    context
  );
  assert.equal(result.status, 'fuzzy-auto');
  assert.equal(result.canonicalFishId, 'cf:sci:corydoras-hastatus');
  // The (differing) extracted scientific name is still reported, e.g. for
  // history bookkeeping, even though it didn't decide the final id.
  assert.equal(result.scientificName, 'Gastrodermus hastatus');
});

test('issue #16: a scientific name with no rival fuzzy candidate is unaffected -- still deterministic', () => {
  const context = buildMatchContext('aquatic-arts', [], []);
  const result = matchCanonicalFish(
    { productIdentifier: '1', commonName: 'Phoenix Rasbora (Boraras merah)', description: '' },
    context
  );
  assert.equal(result.status, 'scientific-name');
  assert.equal(result.canonicalFishId, 'cf:sci:boraras-merah');
});

test('issue #16: a mid-confidence rival fuzzy candidate against a scientific-name match is flagged ambiguous, not silently overridden', () => {
  const context = buildMatchContext('monster-aquarium', [
    existingListing({
      canonicalFishId: 'cf:aquatic-arts:9',
      storeSlug: 'aquatic-arts',
      commonName: 'Blue Cobalt Discus',
    }),
  ], []);
  const result = matchCanonicalFish(
    { productIdentifier: '1', commonName: 'Blue Diamond Discus (Symphysodon aequifasciatus)', description: '' },
    context
  );
  assert.equal(result.status, 'ambiguous');
  // Stays on its own scientific-name id -- a mid-confidence rival isn't
  // confident enough to override a deterministic signal outright. The id
  // carries a ":blue" suffix (issue #34): "Blue Diamond Discus" has a
  // detected "blue" variety, folded into the deterministic id.
  assert.equal(result.canonicalFishId, 'cf:sci:symphysodon-aequifasciatus:blue');
  assert.equal(result.ambiguousCandidate?.canonicalFishId, 'cf:aquatic-arts:9');
});

test('issue #16 regression: an already cross-store-established scientific-name id is NOT hijacked by a same-scoring fuzzy rival', () => {
  // Real production scenario this guards against: "Phoenix Rasbora
  // (Boraras merah)" Listings with a clean, title-parenthetical
  // scientific name were getting pulled into a completely different,
  // already-corrupted "cf:sci:boraras-merah-we" group (itself created by
  // a mis-extraction bug on an unrelated Store's Listing) purely because
  // that corrupted group happened to iterate first and tie at the same
  // fuzzy score. Once a Canonical Fish id already has independent
  // cross-store corroboration under its own slug, a rival must not win.
  const context = buildMatchContext('aquatic-arts', [
    existingListing({
      canonicalFishId: 'cf:sci:boraras-merah',
      storeSlug: 'monster-aquarium',
      commonName: 'Phoenix Rasbora (Boraras merah)',
    }),
    existingListing({
      canonicalFishId: 'cf:sci:boraras-merah-we',
      storeSlug: 'aquahuna',
      commonName: 'Phoenix Rasbora',
    }),
  ], []);
  const result = matchCanonicalFish(
    { productIdentifier: '1', commonName: 'Phoenix Rasbora (Boraras merah)', description: '' },
    context
  );
  assert.equal(result.status, 'scientific-name');
  assert.equal(result.canonicalFishId, 'cf:sci:boraras-merah');
});

test('issue #34: a Listing does not fuzzy-match its own prior-run commonName sitting in an otherwise cross-store candidate', () => {
  // Real-world shape: a Canonical Fish id has cross-store membership
  // overall (so it isn't excluded by the same-Store-only rule), but the
  // specific commonName this query would score highest against is this
  // very Listing's own commonName from before this run started (e.g. an
  // old, now-incorrect grouping it hasn't been individually repointed
  // out of yet). That self-match must not re-anchor it to the old id.
  const context = buildMatchContext('aquahuna', [
    existingListing({ canonicalFishId: 'cf:legacy:mixed', storeSlug: 'aquatic-arts', commonName: 'Bronze Cory' }),
    existingListing({ canonicalFishId: 'cf:legacy:mixed', storeSlug: 'aquahuna', commonName: 'Albino Cory' }),
  ], []);
  const result = matchCanonicalFish(
    { productIdentifier: '1', commonName: 'Albino Cory', description: '' },
    context
  );
  // Must not fuzzy-merge back into the legacy mixed-variety group via its
  // own stale self-entry -- stays on its own trivial id instead (no
  // eligible cross-store candidate: the only "Albino"-compatible name in
  // the pool is this Listing's own, excluded as same-Store).
  assert.notEqual(result.canonicalFishId, 'cf:legacy:mixed');
  assert.equal(result.canonicalFishId, 'cf:aquahuna:1');
});

test('issue #34: a cf:sci: id already contaminated with two varieties splits going forward instead of reinforcing the mix', () => {
  // Real-world shape (pre-dating this fix, or pre-dating every affected
  // Listing getting a chance to individually recompute its own id): one
  // cf:sci:<slug> id's history already mixes two distinct varieties
  // across Stores. A third, same-variety Listing from yet another Store
  // must join the matching sub-cluster only -- not the id's other,
  // incompatible-variety members, just because they share one id string.
  const context = buildMatchContext('nu-aqua-shop', [
    existingListing({ canonicalFishId: 'cf:sci:corydoras-aeneus', storeSlug: 'aquahuna', commonName: 'Orange Venezuelan Cory' }),
    existingListing({ canonicalFishId: 'cf:sci:corydoras-aeneus', storeSlug: 'aquarium-fish', commonName: 'Green Laser Cory' }),
  ], []);
  const result = matchCanonicalFish(
    { productIdentifier: '1', commonName: 'Orange Venezuelan Cory', description: '' },
    context
  );
  assert.equal(result.status, 'fuzzy-auto');
  // Resolves to the orange sub-cluster's own id, distinct from the raw
  // contaminated id and from the green sub-cluster.
  assert.equal(result.canonicalFishId, 'cf:sci:corydoras-aeneus:orange');
});

test('no scientific name and no fuzzy candidate falls back to the trivial per-Listing id', () => {
  const context = buildMatchContext('aquatic-arts', [], []);
  const result = matchCanonicalFish(
    { productIdentifier: '42', commonName: 'Totally Unmatched Fish', description: '' },
    context
  );
  assert.equal(result.status, 'unmatched');
  assert.equal(result.canonicalFishId, 'cf:aquatic-arts:42');
});

function makeEvent(overrides: Partial<CanonicalFishHistoryEvent> = {}): CanonicalFishHistoryEvent {
  return {
    type: 'change',
    observedAt: '2026-01-01T00:00:00.000Z',
    price: 10,
    currency: 'USD',
    available: true,
    variants: [],
    listingId: 'store-a:1',
    storeSlug: 'store-a',
    ...overrides,
  };
}

function makeListingInfo(overrides: Partial<CanonicalFishHistoryListing> = {}): CanonicalFishHistoryListing {
  return {
    listingId: 'store-a:1',
    storeSlug: 'store-a',
    storeName: 'Store A',
    commonName: 'Fish',
    lastCheckedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

test('removeListingFromHistory deletes the whole history when it was the only Listing', () => {
  const history: CanonicalFishHistory = {
    canonicalFishId: 'cf:store-a:1',
    commonName: 'Fish',
    scientificName: null,
    listings: [makeListingInfo()],
    events: [makeEvent()],
  };
  const { remainingHistory, movedEvents } = removeListingFromHistory(history, 'store-a:1');
  assert.equal(remainingHistory, undefined);
  assert.equal(movedEvents.length, 1);
});

test('removeListingFromHistory keeps the history (minus that Listing) when others remain', () => {
  const history: CanonicalFishHistory = {
    canonicalFishId: 'cf:sci:x',
    commonName: 'Fish',
    scientificName: 'Genus speciesus',
    listings: [makeListingInfo(), makeListingInfo({ listingId: 'store-b:1', storeSlug: 'store-b', storeName: 'Store B' })],
    events: [makeEvent(), makeEvent({ listingId: 'store-b:1', storeSlug: 'store-b' })],
  };
  const { remainingHistory, movedEvents } = removeListingFromHistory(history, 'store-a:1');
  assert.equal(remainingHistory?.listings.length, 1);
  assert.equal(remainingHistory?.listings[0].listingId, 'store-b:1');
  assert.equal(remainingHistory?.events.length, 1);
  assert.equal(movedEvents.length, 1);
});

test('mergeListingIntoHistory on a repoint carries moved events over without duplicating or losing them', () => {
  const movedEvents = [makeEvent({ observedAt: '2026-01-01T00:00:00.000Z' })];
  const newEvent = makeEvent({ observedAt: '2026-01-02T00:00:00.000Z', type: 'change' });

  const merged = mergeListingIntoHistory({
    existing: undefined,
    canonicalFishId: 'cf:sci:x',
    listingInfo: makeListingInfo(),
    scientificName: 'Genus speciesus',
    movedEvents,
    newEvent,
  });

  assert.equal(merged.events.length, 2);
  assert.equal(merged.scientificName, 'Genus speciesus');
  assert.equal(merged.listings.length, 1);
});

test('mergeListingIntoHistory with newEvent undefined (issue #81: observed unchanged) appends no event but still advances lastCheckedAt', () => {
  const existing: CanonicalFishHistory = {
    canonicalFishId: 'cf:sci:x',
    commonName: 'Fish',
    scientificName: 'Genus speciesus',
    listings: [makeListingInfo({ lastCheckedAt: '2026-01-01T00:00:00.000Z' })],
    events: [makeEvent({ observedAt: '2026-01-01T00:00:00.000Z' })],
  };

  const merged = mergeListingIntoHistory({
    existing,
    canonicalFishId: 'cf:sci:x',
    listingInfo: makeListingInfo({ lastCheckedAt: '2026-01-05T00:00:00.000Z' }),
    scientificName: 'Genus speciesus',
    movedEvents: [],
    newEvent: undefined,
  });

  assert.equal(merged.events.length, 1); // no new event appended
  assert.equal(merged.listings.length, 1);
  assert.equal(merged.listings[0].lastCheckedAt, '2026-01-05T00:00:00.000Z');
});

test('mergeListingIntoHistory combines two different Listings (two Stores) under one Canonical Fish', () => {
  const existing: CanonicalFishHistory = {
    canonicalFishId: 'cf:sci:symphysodon-aequifasciatus',
    commonName: 'Blue Cobalt Discus',
    scientificName: 'Symphysodon aequifasciatus',
    listings: [makeListingInfo({ listingId: 'monster-aquarium:1', storeSlug: 'monster-aquarium', storeName: 'Monster Aquarium', commonName: 'Blue Cobalt Discus' })],
    events: [makeEvent({ listingId: 'monster-aquarium:1', storeSlug: 'monster-aquarium' })],
  };

  const merged = mergeListingIntoHistory({
    existing,
    canonicalFishId: 'cf:sci:symphysodon-aequifasciatus',
    listingInfo: makeListingInfo({ listingId: 'aquatic-arts:2', storeSlug: 'aquatic-arts', storeName: 'Aquatic Arts', commonName: "Dealer's Choice Discus" }),
    scientificName: 'Symphysodon aequifasciatus',
    movedEvents: [],
    newEvent: makeEvent({ observedAt: '2026-01-05T00:00:00.000Z' }),
  });

  assert.equal(merged.listings.length, 2);
  const storeSlugs = merged.listings.map((l) => l.storeSlug).sort();
  assert.deepEqual(storeSlugs, ['aquatic-arts', 'monster-aquarium']);
  assert.equal(merged.events.length, 2);
});

test('migrateLegacyHistory upgrades a pre-#3 single-Listing history file to the current shape', () => {
  const legacy = {
    canonicalFishId: 'cf:aquatic-arts:1',
    listingId: 'aquatic-arts:1',
    storeSlug: 'aquatic-arts',
    commonName: 'Fish',
    events: [
      { type: 'change', observedAt: '2026-01-01T00:00:00.000Z', price: 1, currency: 'USD', available: true, variants: [] },
      { type: 'change', observedAt: '2026-01-03T00:00:00.000Z', price: 1, currency: 'USD', available: true, variants: [] },
    ],
  };
  assert.equal(isLegacyHistory(legacy), true);
  const migrated = migrateLegacyHistory(legacy);
  assert.equal(migrated.listings.length, 1);
  assert.equal(migrated.listings[0].listingId, 'aquatic-arts:1');
  // Backfilled from this Listing's own last event, since this pre-#3 shape
  // never had a lastCheckedAt field at all (issue #81).
  assert.equal(migrated.listings[0].lastCheckedAt, '2026-01-03T00:00:00.000Z');
  assert.equal(migrated.events[0].listingId, 'aquatic-arts:1');
  assert.equal(isLegacyHistory(migrated), false);
});
