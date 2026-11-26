/**
 * A Listing's `price` of exactly `0.00` is this project's established
 * sold-out placeholder convention (issue #17, reused by `diffListing`/
 * `computeVariantLines`) — some Stores emit it instead of omitting a
 * variant entirely when it's out of stock. Never a genuine free/zero
 * price. Centralized here (issue #86) so every display path that renders a
 * Listing's price/availability shares the exact same rule the price-history
 * chart already applied, instead of each one re-deciding it independently.
 */
export function isSoldOutPlaceholder(price: number): boolean {
  return price === 0;
}

/**
 * The scrape pipeline runs once daily (see `.github/workflows/daily-pipeline.yml`);
 * a Store that hasn't had a successful run in several cadences' worth of
 * time has likely stopped scraping altogether (broken adapter, Store
 * offline, etc.) rather than just landing between two close-together runs —
 * at that point even a Listing that WAS freshly re-observed in that Store's
 * last run is no longer something we can vouch for as "in stock right now".
 */
const STALE_STORE_THRESHOLD_MS = 3 * 24 * 60 * 60 * 1000;

/** The subset of `Listing` this module's functions need. */
export interface FreshnessListing {
  storeSlug: string;
  lastObservedAt: string;
}

/** The subset of `StoreIndexMeta` this module's functions need. */
export interface FreshnessStore {
  lastSuccessfulRunAt: string;
}

/**
 * True when a Listing's displayed price/availability can no longer be
 * vouched for as current (issue #86).
 *
 * `process.ts` deliberately never flags a Listing that vanishes from its
 * Store's catalog (delisted, or temporarily absent) — it just stops
 * updating it, leaving it in `index.json` with whatever `lastObservedAt` it
 * already had (see the comment at that filter in `process.ts`). That
 * leaves exactly one reliable signal on the frontend: this Listing's Store
 * has since completed a run (`lastSuccessfulRunAt` advanced) that did NOT
 * re-observe it (`lastObservedAt` didn't advance to match) — if the Store's
 * latest run is newer than this Listing's own last observation, the
 * Listing was absent from that run. That's exact, not a guess, and flags a
 * vanished Listing on the very next run after it disappears, regardless of
 * how little time has passed.
 *
 * The second, independent case: the Store's OWN last successful run is
 * itself far behind `now` (`STALE_STORE_THRESHOLD_MS`) — the whole Store's
 * data is old, so even a Listing that matches its Store's last run exactly
 * is stale right along with it.
 *
 * A Store missing from `stores` (shouldn't normally happen; defensive
 * only) is treated as not-stale rather than guessing.
 */
export function isListingStale(
  listing: FreshnessListing,
  stores: Record<string, FreshnessStore>,
  now: Date,
): boolean {
  const store = stores[listing.storeSlug];
  if (!store) return false;

  const lastObserved = new Date(listing.lastObservedAt).getTime();
  const lastSuccessfulRun = new Date(store.lastSuccessfulRunAt).getTime();

  if (lastSuccessfulRun > lastObserved) return true; // vanished from the catalog
  if (now.getTime() - lastSuccessfulRun > STALE_STORE_THRESHOLD_MS) return true; // Store itself stopped scraping

  return false;
}

/** The subset of `Listing` `displayListingStatus` needs, beyond `FreshnessListing`. */
export interface DisplayableListing extends FreshnessListing {
  available: boolean;
  price: number;
}

/** What a shopper should actually be shown for one Listing's price/availability. */
export interface ListingDisplayStatus {
  /** Whether this Listing should read as confidently purchasable right now. */
  available: boolean;
  /** The real price to show, or `null` when there is none worth showing (the $0.00 placeholder). */
  price: number | null;
}

/**
 * The single place every shopper-facing surface (browse cards, the fish
 * detail page, "From $X" lowest-price badges) should derive a Listing's
 * displayed price/availability from (issue #86) — rather than each reading
 * `listing.available`/`listing.price` directly and re-deriving (or missing)
 * the same two exceptions:
 *
 *   - the `price === 0` sold-out placeholder (see `isSoldOutPlaceholder`)
 *     never displays as a real purchasable price, and a Listing priced at
 *     it never reads as available no matter what its own `available` flag
 *     says.
 *   - a stale Listing (see `isListingStale`) — vanished from its Store's
 *     catalog, or its Store's own data just old — no longer reads as
 *     confidently "in stock", regardless of its own `available` flag.
 *
 * A fresh, real-priced, genuinely out-of-stock Listing is unaffected: its
 * real price still shows (so a shopper can see what it normally costs),
 * only `available` stays `false`.
 */
export function displayListingStatus(
  listing: DisplayableListing,
  stores: Record<string, FreshnessStore>,
  now: Date,
): ListingDisplayStatus {
  const placeholder = isSoldOutPlaceholder(listing.price);
  const stale = isListingStale(listing, stores, now);
  return {
    available: listing.available && !placeholder && !stale,
    price: placeholder ? null : listing.price,
  };
}
