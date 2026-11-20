import { parseShopifyListings } from './lib/shopify-parser.js';
import { passesSafetyNetCheck } from './lib/safety-net.js';
import {
  buildMatchContext,
  matchCanonicalFish,
  removeListingFromHistory,
  mergeListingIntoHistory,
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
import type { CanonicalFishHistoryEvent, CanonicalFishHistoryListing, Listing, PendingMatch } from './types/listing.js';

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

  for (const parsed of parsedListings) {
    const listingId = `${store.slug}:${parsed.productIdentifier}`;
    const previous = previousListingsById.get(listingId);
    const match = matchCanonicalFish(parsed, matchContext);

    const listing: Listing = {
      ...parsed,
      listingId,
      storeSlug: store.slug,
      storeName: store.name,
      canonicalFishId: match.canonicalFishId,
      scientificName: match.scientificName,
      firstObservedAt: previous?.firstObservedAt ?? now,
      lastObservedAt: now,
    };
    nextListings.push(listing);

    const diffEvent = diffListing(previous, listing);
    if (diffEvent.type === 'change') {
      changeCount++;
    } else {
      heartbeatCount++;
    }

    // If this Listing's Canonical Fish id changed since last run (a new
    // scientific-name/fuzzy match appeared, or a maintainer added an
    // override), move its prior history out of the old Canonical Fish
    // so it isn't lost (left under an id nothing points to any more) or
    // duplicated (kept under both the old and new id).
    let movedEvents: CanonicalFishHistoryEvent[] = [];
    if (previous && previous.canonicalFishId !== match.canonicalFishId) {
      const oldHistory = readHistoryFile(dataDir, previous.canonicalFishId);
      if (oldHistory) {
        const { remainingHistory, movedEvents: moved } = removeListingFromHistory(oldHistory, listingId);
        movedEvents = moved;
        if (remainingHistory) {
          writeHistoryFile(dataDir, remainingHistory);
        } else {
          deleteHistoryFile(dataDir, previous.canonicalFishId);
        }
      }
    }

    const listingInfo: CanonicalFishHistoryListing = {
      listingId,
      storeSlug: store.slug,
      storeName: store.name,
      commonName: listing.commonName,
    };
    const mergedHistory = mergeListingIntoHistory({
      existing: readHistoryFile(dataDir, match.canonicalFishId),
      canonicalFishId: match.canonicalFishId,
      listingInfo,
      scientificName: match.scientificName,
      movedEvents,
      newEvent: diffEvent,
    });
    writeHistoryFile(dataDir, mergedHistory);

    if (match.status === 'ambiguous' && match.ambiguousCandidate) {
      ambiguousCount++;
      const prior = previousPendingByListingId.get(listingId);
      const firstDetectedAt =
        prior && prior.candidateCanonicalFishId === match.ambiguousCandidate.canonicalFishId ? prior.firstDetectedAt : now;
      pendingMatches.push({
        listingId,
        storeSlug: store.slug,
        commonName: listing.commonName,
        candidateCanonicalFishId: match.ambiguousCandidate.canonicalFishId,
        candidateCommonName: match.ambiguousCandidate.commonName,
        score: Math.round(match.ambiguousCandidate.score * 1000) / 1000,
        firstDetectedAt,
        lastDetectedAt: now,
      });
    }
  }

  writePendingMatches(dataDir, pendingMatches);

  // A Listing that vanishes from this Scrape Run (delisted, or temporarily
  // absent from the catalog) is not removed and gets no Delisted signal
  // (out of scope per the PRD) -- it simply stops updating, staying in
  // index.json with whatever lastObservedAt it already had.
  const nextListingIds = new Set(nextListings.map((listing) => listing.listingId));
  const unseenListingsForStore = index.listings.filter(
    (listing) => listing.storeSlug === store.slug && !nextListingIds.has(listing.listingId)
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
