import { parseShopifyListings } from './lib/shopify-parser.js';
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

export interface ProcessStoreRunResult {
  storeSlug: string;
  accepted: boolean;
  /** Present only when accepted is false. */
  rejectionReason?: string;
  listingCount: number;
  changeCount: number;
  heartbeatCount: number;
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
 * id), diffs against the previously recorded state to emit a Change
 * Event or Heartbeat per Listing, and writes the result into the `data`
 * branch worktree at `dataDir` (index.json, one history file per
 * Canonical Fish, and pending-matches.json for ambiguous matches). Does
 * not commit or push — the caller decides when a batch of stores is done.
 */
export function processStoreRun(params: {
  store: StoreConfig;
  rawData: unknown;
  dataDir: string;
  now?: Date;
}): ProcessStoreRunResult {
  const { store, rawData, dataDir } = params;
  const now = (params.now ?? new Date()).toISOString();

  const parsedListings = parseShopifyListings(rawData, store);
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
      heartbeatCount: 0,
      ambiguousCount: 0,
    };
  }

  const previousListingsById = new Map<string, Listing>(
    index.listings.filter((listing) => listing.storeSlug === store.slug).map((listing) => [listing.listingId, listing])
  );

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
  let heartbeatCount = 0;
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

  const groupsByCanonicalFishId = new Map<string, { parsed: ParsedListing; match: MatchResult }[]>();
  for (const entry of matched) {
    const group = groupsByCanonicalFishId.get(entry.match.canonicalFishId) ?? [];
    group.push(entry);
    groupsByCanonicalFishId.set(entry.match.canonicalFishId, group);
  }

  // Every old (pre-merge) listingId absorbed into a merged Listing this
  // run -- excluded below from the "unseen Listing" bookkeeping, since
  // being consolidated into a new listingId is not the same thing as
  // vanishing from the catalog (see the comment at that filter).
  const supersededListingIds = new Set<string>();

  for (const [canonicalFishId, group] of groupsByCanonicalFishId) {
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
      ...group.map((g) => previousListingsById.get(`${store.slug}:${g.parsed.productIdentifier}`)?.firstObservedAt),
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
    const previous = previousListingsById.get(listingId);
    const diffEvent = diffListing(previous, listing);
    if (diffEvent.type === 'change') {
      changeCount++;
    } else {
      heartbeatCount++;
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
    const movedEvents: CanonicalFishHistoryEvent[] = [];
    for (const { parsed: groupParsed } of group) {
      const oldListingId = `${store.slug}:${groupParsed.productIdentifier}`;
      const oldPrevious = previousListingsById.get(oldListingId);
      if (!oldPrevious) {
        continue; // never seen before -- nothing to move.
      }
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

    const listingInfo: CanonicalFishHistoryListing = {
      listingId,
      storeSlug: store.slug,
      storeName: store.name,
      commonName: listing.commonName,
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
    heartbeatCount,
    ambiguousCount,
  };
}
