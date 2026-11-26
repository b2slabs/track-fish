import { displayListingStatus, type FreshnessStore } from './listing-freshness';
import type { Listing } from '@/types/data';

/**
 * One card's worth of browse-page data: every Listing across Stores that
 * shares a `canonicalFishId` (see docs/adr/0002-canonical-fish-is-species-level.md),
 * collapsed down to a single representative Listing for display.
 */
export interface GroupedListing {
  canonicalFishId: string;
  /**
   * The Listing whose price/name/image drive the card: the lowest-priced
   * displayably in-stock, non-placeholder ($0) Listing in the group, or —
   * if none of the group's Listings qualify — the lowest real
   * (non-placeholder) price among all of them (issue #39). "Displayably"
   * uses each Listing's `displayListingStatus` (issue #86), not its raw
   * `available`/`price` — a stale (vanished-from-catalog) Listing is never
   * eligible here even if its own `available` flag still says true. This
   * may NOT be the globally lowest raw `price`.
   */
  representative: Listing;
  /** Every Listing in the group (after upstream filtering), one per Store. */
  listings: Listing[];
  /** Count of distinct Stores carrying this Canonical Fish in `listings`. */
  storeCount: number;
  /**
   * True if ANY Listing in the group is displayably in stock (issue #39,
   * #86) — not merely whether `representative` itself is, since
   * `representative` may end up being an out-of-stock Listing when nothing
   * in the group is both in-stock and real-priced. Uses
   * `displayListingStatus`, so a stale or placeholder-priced Listing never
   * counts as "in stock" here even if its own `available` flag says true.
   */
  available: boolean;
  /** Count of distinct Stores where this Canonical Fish is currently in stock (<= storeCount). */
  inStockStoreCount: number;
}

/**
 * Groups Listings by `canonicalFishId` so the browse page can render one
 * card per Canonical Fish instead of one per Store's Listing (issue #20).
 *
 * Call this AFTER search/store/availability filtering, not before: grouping
 * post-filter means a group only appears if at least one of its Listings
 * survived the filters, and the group's representative price / storeCount
 * are derived only from the Listings that matched — which is exactly what
 * makes "a store filter should include a grouped card if any of its
 * underlying Listings match that store" fall out for free, without any
 * group-aware filtering logic.
 *
 * `stores` (`IndexFile.stores`) and `now` (issue #86) feed every Listing's
 * `displayListingStatus` here, so "in stock"/representative-price
 * decisions for the whole group are based on the same stale/placeholder-
 * aware status every other display surface uses — not the Listing's own
 * raw `available`/`price`, which may say "in stock" for a Listing that's
 * actually vanished from its Store's catalog or carrying the $0.00
 * sold-out placeholder.
 */
export function groupListingsByCanonicalFish(
  listings: Listing[],
  stores: Record<string, FreshnessStore>,
  now: Date = new Date(),
): GroupedListing[] {
  const order: string[] = [];
  const groups = new Map<string, Listing[]>();

  for (const listing of listings) {
    const bucket = groups.get(listing.canonicalFishId);
    if (bucket) {
      bucket.push(listing);
    } else {
      groups.set(listing.canonicalFishId, [listing]);
      order.push(listing.canonicalFishId);
    }
  }

  return order.map((canonicalFishId) => {
    const groupListings = groups.get(canonicalFishId) as Listing[];
    const representative = pickRepresentative(groupListings, stores, now);
    const statuses = new Map(groupListings.map((l) => [l, displayListingStatus(l, stores, now)]));
    const storeCount = new Set(groupListings.map((l) => l.storeSlug)).size;
    const available = groupListings.some((l) => statuses.get(l)!.available);
    const inStockStoreCount = new Set(
      groupListings.filter((l) => statuses.get(l)!.available).map((l) => l.storeSlug),
    ).size;
    return {
      canonicalFishId,
      representative,
      listings: groupListings,
      storeCount,
      available,
      inStockStoreCount,
    };
  });
}

/**
 * Picks the Listing that should drive a group's card (issue #39), using
 * each Listing's display-safe status (issue #86) rather than its raw
 * `available`/`price` — see `displayListingStatus`.
 *
 * Preferred: the lowest-priced Listing that is both displayably in stock
 * AND has a real (non-placeholder, non-stale) price.
 *
 * Fallback (nothing in the group is both in-stock and real-priced): the
 * lowest real (non-placeholder) price among ALL Listings in the group, so
 * a genuinely all-out-of-stock group still shows a real price instead of a
 * $0 placeholder.
 *
 * Last resort (every Listing in the group is priced at the placeholder):
 * just the first Listing, to guarantee a representative always exists.
 *
 * Exported (issue #91) so `FishDetailPage` can pick its header name/
 * scientific-name subtitle with the exact same rule the browse grid uses
 * for its card — before this, the detail page picked its "primary"
 * Listing by a completely different rule (whichever Listing had an
 * image), so the same Canonical Fish could show two different common
 * names depending which page you were on. The image itself may still
 * come from a different Listing (not every representative Listing has
 * one), but the *name* is now always this function's pick, on both
 * pages.
 *
 * `stores`/`now` (issue #86) default to `{}`/`new Date()` so existing
 * callers that don't have freshness data (e.g. a caller with only the
 * Listings in hand) still work, but every "in stock"/"real price" check
 * here goes through the same stale/placeholder-aware `displayListingStatus`
 * every other display surface uses.
 */
export function pickRepresentative(
  groupListings: Listing[],
  stores: Record<string, FreshnessStore> = {},
  now: Date = new Date(),
): Listing {
  const statuses = new Map(groupListings.map((l) => [l, displayListingStatus(l, stores, now)]));
  const inStockPriced = groupListings.filter((l) => {
    const status = statuses.get(l)!;
    return status.available && status.price !== null;
  });
  if (inStockPriced.length > 0) {
    return inStockPriced.reduce((lowest, l) => (l.price < lowest.price ? l : lowest));
  }

  const realPriced = groupListings.filter((l) => statuses.get(l)!.price !== null);
  if (realPriced.length > 0) {
    return realPriced.reduce((lowest, l) => (l.price < lowest.price ? l : lowest));
  }

  return groupListings[0];
}
