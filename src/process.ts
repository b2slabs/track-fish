import { parseShopifyListings } from './lib/shopify-parser.js';
import { parseWooCommerceListings } from './lib/woocommerce-parser.js';
import { passesSafetyNetCheck } from './lib/safety-net.js';
import {
  buildMatchContext,
  matchCanonicalFish,
  removeListingFromHistory,
  mergeListingIntoHistory,
  mergedListingId,
  pickRepresentative,
  mergeVariants,
  representativePriceAndAvailability,
  type MatchResult,
} from './lib/canonical-fish.js';
import { isBundleListing } from './lib/bundle.js';
import { diffListing } from './lib/diff.js';
import {
  readIndexFile,
  writeIndexFile,
  readHistoryFile,
  writeHistoryFile,
  deleteHistoryFile,
  readPendingMatches,
  writePendingMatches,
} from './lib/data-branch.js';
import canonicalFishOverrides from './config/canonical-fish-overrides.js';
import type {
  CanonicalFishHistoryEvent,
  CanonicalFishHistoryListing,
  Listing,
  ParsedListing,
  PendingMatch,
} from './types/listing.js';

export interface StoreConfig {
  name: string;
  slug: string;
  domain: string;
  platform: string;
  collectionHandle?: string;
  currency?: string;
}

// Mirrors `scrape.ts`'s adapter-dispatch map: each configured Store's
// `platform` picks which raw-snapshot shape to parse into ParsedListings,
// the same way it picks which StoreAdapter scrapes it in the first place.
const parserMap: Record<string, (raw: unknown, store: StoreConfig) => ParsedListing[]> = {
  shopify: parseShopifyListings,
  woocommerce: parseWooCommerceListings,
};

export interface ProcessStoreRunResult {
  storeSlug: string;
  accepted: boolean;
  /** Present only when accepted is false. */
  rejectionReason?: string;
  listingCount: number;
  changeCount: number;
  /** Listings observed unchanged this run — their `lastCheckedAt` on the
   * history file was advanced, but no Heartbeat event was written (see
   * issue #81: Heartbeat events no longer exist at all). */
  unchangedCount: number;
  /** Listings whose best automatic Canonical Fish match was ambiguous
   * this run — recorded in pending-matches.json, not auto-merged. */
  ambiguousCount: number;
}

/**
 * Normalizes one Store's raw archived snapshot into the processed layer
 * (see issue #2 / docs/adr/0003): parses Listings, applies the safety-net
 * validation guard, matches each Listing to a Canonical Fish (see issue
 * #3 / `canonical-fish.ts` — by maintainer override, then scientific
 * name, then fuzzy common-name, falling back to a trivial per-Listing
 * id), diffs against the previously recorded state to emit a Change Event
 * for each Listing whose price/availability genuinely differs — or, for
 * one observed unchanged, advances its `lastCheckedAt` on the history
 * file in place instead (issue #81: no Heartbeat event is ever written) —
 * and writes the result into the `data` branch worktree at `dataDir`
 * (index.json, one history file per Canonical Fish, and
 * pending-matches.json for ambiguous matches). Does not commit or push —
 * the caller decides when a batch of stores is done.
 */
export function processStoreRun(params: {
  store: StoreConfig;
  rawData: unknown;
  dataDir: string;
  now?: Date;
}): ProcessStoreRunResult {
  const { store, rawData, dataDir } = params;
  const now = (params.now ?? new Date()).toISOString();

  const parseListings = parserMap[store.platform];
  if (!parseListings) {
    throw new Error(`No listing parser found for platform: ${store.platform}`);
  }
  const parsedListings = parseListings(rawData, store);
  const index = readIndexFile(dataDir);
  const previousMeta = index.stores[store.slug];
  const previousListingCount = previousMeta?.lastSuccessfulListingCount;

  if (!passesSafetyNetCheck(parsedListings.length, previousListingCount)) {
    return {
      storeSlug: store.slug,
      accepted: false,
      rejectionReason: `parsed Listing count ${parsedListings.length} is more than a 50% drop from the last successful run's ${previousListingCount}`,
      listingCount: parsedListings.length,
      changeCount: 0,
      unchangedCount: 0,
      ambiguousCount: 0,
    };
  }

  const previousListingsById = new Map<string, Listing>(
    index.listings.filter((listing) => listing.storeSlug === store.slug).map((listing) => [listing.listingId, listing])
  );

  // Every individual pre-merge productIdentifier (for this Store) mapped
  // to whichever previous Listing -- standalone or already-merged -- it
  // was last part of. A merge group's *composition* can change between
  // runs (a bundle Listing just introduced to `isBundleListing` getting
  // carved back out of a group it used to be merged into, a new sibling
  // product appearing, etc.); this is what lets the lookups below survive
  // that, instead of only ever finding a previous Listing under its own
  // exact (old) listingId.
  const previousListingsByProductId = new Map<string, Listing>();
  for (const prevListing of previousListingsById.values()) {
    const compoundSuffix = prevListing.listingId.slice(`${store.slug}:`.length);
    for (const productId of compoundSuffix.split('+')) {
      previousListingsByProductId.set(productId, prevListing);
    }
  }

  // The matching context is built once per Store run (not once per
  // Listing) from every Listing currently known across every Store, as
  // of the start of this run -- see `buildMatchContext`.
  const matchContext = buildMatchContext(store.slug, index.listings, canonicalFishOverrides);

  const existingPendingMatches = readPendingMatches(dataDir);
  const previousPendingByListingId = new Map(existingPendingMatches.map((p) => [p.listingId, p]));
  // Ambiguous matches are recomputed fresh for every Listing this Store
  // run touches, so a resolved (or no-longer-ambiguous) entry drops out
  // on its own instead of needing to be cleaned up by hand. Pending
  // entries for *other* Stores, not touched this run, are left alone.
  const pendingMatches: PendingMatch[] = existingPendingMatches.filter((p) => p.storeSlug !== store.slug);

  const nextListings: Listing[] = [];
  let changeCount = 0;
  let unchangedCount = 0;
  let ambiguousCount = 0;

  // Match every parsed Listing first (matching itself is per-Listing and
  // unaffected by same-Store merging -- each Shopify product is still
  // matched on its own title/description), then group by the resulting
  // canonicalFishId. A group of more than one is exactly issue #56's
  // "same Store, same Canonical Fish, two separate Shopify products" case
  // -- there should only ever be one Listing per Store per Canonical Fish,
  // so those groups get merged into a single logical Listing below rather
  // than written through as separate Listings.
  const matched: { parsed: ParsedListing; match: MatchResult }[] = parsedListings.map((parsed) => ({
    parsed,
    match: matchCanonicalFish(parsed, matchContext),
  }));

  for (const { parsed, match } of matched) {
    const listingId = `${store.slug}:${parsed.productIdentifier}`;
    if (match.status === 'ambiguous' && match.ambiguousCandidate) {
      ambiguousCount++;
      const prior = previousPendingByListingId.get(listingId);
      const firstDetectedAt =
        prior && prior.candidateCanonicalFishId === match.ambiguousCandidate.canonicalFishId ? prior.firstDetectedAt : now;
      pendingMatches.push({
        listingId,
        storeSlug: store.slug,
        commonName: parsed.commonName,
        candidateCanonicalFishId: match.ambiguousCandidate.canonicalFishId,
        candidateCommonName: match.ambiguousCandidate.commonName,
        score: Math.round(match.ambiguousCandidate.score * 1000) / 1000,
        firstDetectedAt,
        lastDetectedAt: now,
      });
    }
  }
  writePendingMatches(dataDir, pendingMatches);

  // Group by canonicalFishId to find same-Store merge candidates -- except
  // a bundle/combo/variety-pack/"choose your own" Listing (see
  // `isBundleListing`), which is a genuinely different product type from
  // a plain variant of the base species and must never be folded into a
  // merge group, even with another bundle Listing sharing the same
  // canonicalFishId (two different combo configurations are still two
  // different products). Each gets a unique grouping key -- its own
  // listingId -- so it always stays a standalone group of one.
  const groupsByCanonicalFishId = new Map<string, { parsed: ParsedListing; match: MatchResult }[]>();
  for (const entry of matched) {
    const key = isBundleListing(entry.parsed.commonName)
      ? `bundle:${store.slug}:${entry.parsed.productIdentifier}`
      : entry.match.canonicalFishId;
    const group = groupsByCanonicalFishId.get(key) ?? [];
    group.push(entry);
    groupsByCanonicalFishId.set(key, group);
  }

  // Every old (pre-merge) listingId absorbed into a merged Listing this
  // run -- excluded below from the "unseen Listing" bookkeeping, since
  // being consolidated into a new listingId is not the same thing as
  // vanishing from the catalog (see the comment at that filter).
  const supersededListingIds = new Set<string>();

  for (const group of groupsByCanonicalFishId.values()) {
    // The grouping key is a synthetic per-Listing key for a bundle Listing
    // (see above), not necessarily its real canonicalFishId -- always
    // derive the real one from a group member's own match result instead
    // of the map key.
    const canonicalFishId = group[0].match.canonicalFishId;
    const isMergeGroup = group.length > 1;
    const listingId = isMergeGroup
      ? mergedListingId(store.slug, group.map((g) => g.parsed.productIdentifier))
      : `${store.slug}:${group[0].parsed.productIdentifier}`;

    const representative = isMergeGroup ? pickRepresentative(group.map((g) => g.parsed)) : group[0].parsed;
    const variants = isMergeGroup
      ? mergeVariants(group.map((g) => ({ commonName: g.parsed.commonName, variants: g.parsed.variants })))
      : representative.variants;
    const { price, available } = isMergeGroup
      ? representativePriceAndAvailability(variants)
      : { price: representative.price, available: representative.available };
    const scientificName = group.map((g) => g.match.scientificName).find((n): n is string => n != null) ?? null;

    // firstObservedAt carries through from whichever of this group's old
    // listingIds already existed -- the earliest one, if more than one
    // did -- so a same-Store merge doesn't make a Listing this project has
    // tracked for a while look brand new. Checks both the merged listingId
    // itself (the steady state, once this merge has happened on a prior
    // run) and each individual pre-merge productIdentifier-derived id (the
    // one-time transition run that first collapses them).
    const priorFirstObservedAt = [
      previousListingsById.get(listingId)?.firstObservedAt,
      ...group.map((g) => previousListingsByProductId.get(g.parsed.productIdentifier)?.firstObservedAt),
    ]
      .filter((v): v is string => v != null)
      .sort()[0];

    const listing: Listing = {
      ...representative,
      price,
      available,
      variants,
      listingId,
      storeSlug: store.slug,
      storeName: store.name,
      canonicalFishId,
      scientificName,
      firstObservedAt: priorFirstObservedAt ?? now,
      lastObservedAt: now,
    };
    nextListings.push(listing);

    // `previous` is this merged listingId's own prior state -- present
    // from the second run onward once this merge has happened once; on
    // the one-time transition run that first collapses two old listingIds
    // into this one, there is none yet, so the diff is a fresh
    // 'first-observed' Change Event (the same treatment a genuinely new
    // Listing gets).
    //
    // Falls back to `previousListingsByProductId` (same rationale as
    // `priorFirstObservedAt` above) when the exact merged listingId isn't
    // found -- issue #96: a merge group's *composition* can change between
    // runs (a sibling product newly appearing or dropping out) even when
    // no individual product is actually new, which changes the compound
    // listingId string itself. Without this fallback, `previousListingsById`
    // would never find that already-tracked product under its *new*
    // compound id, and this would misfire as a spurious 'first-observed'
    // Change Event -- resetting a Listing's visible history -- instead of
    // the genuine (if any) price/availability/variants diff it actually is.
    // When more than one of this group's products already had its own
    // separate prior history (a first-time merge of two previously
    // untracked-together Listings), the earliest-established one is used,
    // mirroring `priorFirstObservedAt`'s own earliest-wins tie-break.
    const previousCandidates = group
      .map((g) => previousListingsByProductId.get(g.parsed.productIdentifier))
      .filter((l): l is Listing => l != null)
      .sort((a, b) => (a.firstObservedAt < b.firstObservedAt ? -1 : a.firstObservedAt > b.firstObservedAt ? 1 : 0));
    const previous = previousListingsById.get(listingId) ?? previousCandidates[0];
    const diffEvent = diffListing(previous, listing);
    if (diffEvent) {
      changeCount++;
    } else {
      unchangedCount++;
    }

    // Move every old listingId this group absorbs out of wherever its
    // history currently lives (its own last-known canonicalFishId, which
    // may or may not be this run's) and into this Canonical Fish's
    // history, retagged onto the new merged listingId -- the same
    // remove/move technique `removeListingFromHistory`/
    // `mergeListingIntoHistory` already use for a single Listing's
    // canonicalFishId changing between runs, just applied here to collapse
    // two (or more) sibling Listings' histories into one instead of
    // repointing one Listing on its own. Deliberately NOT deduplicated
    // against each other when two old Listings happen to share an
    // observedAt (the common case -- both scraped in the same run): each
    // carries a real, distinct price/variant observation worth keeping,
    // and `computeStoreInstants` on the frontend already pools same-
    // timestamp events for one Store together regardless of listingId.
    //
    // Looks up each old Listing via `previousListingsByProductId` (not a
    // reconstructed `${store.slug}:${productIdentifier}`), so this still
    // finds it even when it was last written under a *different* merge
    // grouping's compound listingId -- e.g. a bundle Listing (see
    // `isBundleListing`) being carved back out of a group it used to be
    // wrongly merged into. `processedOldListingIds` guards against
    // processing that same old compound listingId more than once when
    // more than one of today's groups shares it (its history can only be
    // moved into whichever one is processed first; see the module-level
    // limitation note on `mergedListingId`).
    const movedEvents: CanonicalFishHistoryEvent[] = [];
    const processedOldListingIds = new Set<string>();
    for (const { parsed: groupParsed } of group) {
      const oldPrevious = previousListingsByProductId.get(groupParsed.productIdentifier);
      if (!oldPrevious) {
        continue; // never seen before -- nothing to move.
      }
      const oldListingId = oldPrevious.listingId;
      if (processedOldListingIds.has(oldListingId)) {
        continue; // already moved earlier in this same group's loop.
      }
      processedOldListingIds.add(oldListingId);
      const listingIdChanged = oldListingId !== listingId;
      const canonicalFishIdChanged = oldPrevious.canonicalFishId !== canonicalFishId;
      if (!listingIdChanged && !canonicalFishIdChanged) {
        continue; // steady state: same listingId, same Canonical Fish -- nothing moved.
      }
      if (listingIdChanged) {
        supersededListingIds.add(oldListingId);
      }
      const oldHistory = readHistoryFile(dataDir, oldPrevious.canonicalFishId);
      if (!oldHistory) {
        continue;
      }
      const { remainingHistory, movedEvents: moved } = removeListingFromHistory(oldHistory, oldListingId);
      if (remainingHistory) {
        writeHistoryFile(dataDir, remainingHistory);
      } else {
        deleteHistoryFile(dataDir, oldPrevious.canonicalFishId);
      }
      movedEvents.push(...moved.map((event) => ({ ...event, listingId, storeSlug: store.slug })));
    }

    // `lastCheckedAt` is set to `now` unconditionally -- this Listing was
    // just observed this run, whether or not anything changed (issue #81).
    // This is the only place that pointer ever advances; a Listing not
    // touched this run (a different Store's Listing sharing this Canonical
    // Fish, or this Listing itself on a run where it vanished from the
    // catalog) keeps whatever `lastCheckedAt` it already had, via
    // `mergeListingIntoHistory`'s upsert-by-listingId.
    const listingInfo: CanonicalFishHistoryListing = {
      listingId,
      storeSlug: store.slug,
      storeName: store.name,
      commonName: listing.commonName,
      lastCheckedAt: now,
    };
    const mergedHistory = mergeListingIntoHistory({
      existing: readHistoryFile(dataDir, canonicalFishId),
      canonicalFishId,
      listingInfo,
      scientificName,
      movedEvents,
      newEvent: diffEvent,
    });
    writeHistoryFile(dataDir, mergedHistory);
  }

  // A Listing that vanishes from this Scrape Run (delisted, or temporarily
  // absent from the catalog) is not removed and gets no Delisted signal
  // (out of scope per the PRD) -- it simply stops updating, staying in
  // index.json with whatever lastObservedAt it already had. A Listing
  // superseded by a same-Store merge this run (see `supersededListingIds`)
  // is excluded here even though it's also missing from `nextListings`
  // under its own old id -- it hasn't vanished, it's been consolidated
  // into a new merged listingId that *is* in `nextListings`, so keeping
  // its old entry around would leave a stale duplicate behind forever.
  const nextListingIds = new Set(nextListings.map((listing) => listing.listingId));
  const unseenListingsForStore = index.listings.filter(
    (listing) =>
      listing.storeSlug === store.slug &&
      !nextListingIds.has(listing.listingId) &&
      !supersededListingIds.has(listing.listingId)
  );
  const otherStoresListings = index.listings.filter((listing) => listing.storeSlug !== store.slug);
  index.listings = [...otherStoresListings, ...unseenListingsForStore, ...nextListings].sort((a, b) =>
    a.listingId.localeCompare(b.listingId)
  );
  index.stores[store.slug] = {
    name: store.name,
    domain: store.domain,
    lastSuccessfulRunAt: now,
    lastSuccessfulListingCount: parsedListings.length,
  };
  index.generatedAt = now;
  writeIndexFile(dataDir, index);

  return {
    storeSlug: store.slug,
    accepted: true,
    listingCount: parsedListings.length,
    changeCount,
    unchangedCount,
    ambiguousCount,
  };
}
