import { parseShopifyListings } from './lib/shopify-parser.js';
import { passesSafetyNetCheck } from './lib/safety-net.js';
import { buildListingRecord } from './lib/canonical-fish.js';
import { diffListing } from './lib/diff.js';
import {
  readIndexFile,
  writeIndexFile,
  readHistoryFile,
  writeHistoryFile,
} from './lib/data-branch.js';
import type { Listing } from './types/listing.js';

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
}

/**
 * Normalizes one Store's raw archived snapshot into the processed layer
 * (see issue #2 / docs/adr/0003): parses Listings, applies the safety-net
 * validation guard, assigns each Listing its (trivial, 1:1) Canonical
 * Fish id, diffs against the previously recorded state to emit a Change
 * Event or Heartbeat per Listing, and writes the result into the `data`
 * branch worktree at `dataDir` (index.json plus one history file per
 * Canonical Fish). Does not commit or push — the caller decides when a
 * batch of stores is done.
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
    };
  }

  const previousListingsById = new Map<string, Listing>(
    index.listings.filter((listing) => listing.storeSlug === store.slug).map((listing) => [listing.listingId, listing])
  );

  const nextListings: Listing[] = [];
  let changeCount = 0;
  let heartbeatCount = 0;

  for (const parsed of parsedListings) {
    const previous = previousListingsById.get(`${store.slug}:${parsed.productIdentifier}`);
    const listing = buildListingRecord(parsed, store, now, previous);
    nextListings.push(listing);

    const event = diffListing(previous, listing);
    if (event.type === 'change') {
      changeCount++;
    } else {
      heartbeatCount++;
    }

    const history = readHistoryFile(dataDir, listing.canonicalFishId) ?? {
      canonicalFishId: listing.canonicalFishId,
      listingId: listing.listingId,
      storeSlug: listing.storeSlug,
      commonName: listing.commonName,
      events: [],
    };
    history.commonName = listing.commonName;
    history.events.push(event);
    writeHistoryFile(dataDir, history);
  }

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
  };
}
