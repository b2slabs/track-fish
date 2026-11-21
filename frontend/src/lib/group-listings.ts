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
   * in-stock, non-placeholder ($0) Listing in the group, or — if none of
   * the group's Listings qualify — the lowest non-zero price among all of
   * them (issue #39). This may NOT be the globally lowest raw `price`.
   */
  representative: Listing;
  /** Every Listing in the group (after upstream filtering), one per Store. */
  listings: Listing[];
  /** Count of distinct Stores carrying this Canonical Fish in `listings`. */
  storeCount: number;
  /**
   * True if ANY Listing in the group is in stock (issue #39) — not merely
   * whether `representative` itself is, since `representative` may end up
   * being an out-of-stock Listing when nothing in the group is both
   * in-stock and non-placeholder-priced.
   */
  available: boolean;
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
 */
export function groupListingsByCanonicalFish(listings: Listing[]): GroupedListing[] {
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
    const representative = pickRepresentative(groupListings);
    const storeCount = new Set(groupListings.map((l) => l.storeSlug)).size;
    const available = groupListings.some((l) => l.available);
    return { canonicalFishId, representative, listings: groupListings, storeCount, available };
  });
}

/**
 * Picks the Listing that should drive a group's card (issue #39).
 *
 * Preferred: the lowest-priced Listing that is both in stock AND has a real
 * (non-zero) price — a `price` of 0 is a sold-out placeholder some Stores
 * emit rather than a genuine free/zero price, so it's never eligible here.
 *
 * Fallback (nothing in the group is both in-stock and non-zero-priced):
 * the lowest non-zero price among ALL Listings in the group, so a
 * genuinely all-out-of-stock group still shows a real price instead of a
 * $0 placeholder.
 *
 * Last resort (every Listing in the group is priced at 0): just the first
 * Listing, to guarantee a representative always exists.
 */
function pickRepresentative(groupListings: Listing[]): Listing {
  const inStockPriced = groupListings.filter((l) => l.available && l.price > 0);
  if (inStockPriced.length > 0) {
    return inStockPriced.reduce((lowest, l) => (l.price < lowest.price ? l : lowest));
  }

  const nonZeroPriced = groupListings.filter((l) => l.price > 0);
  if (nonZeroPriced.length > 0) {
    return nonZeroPriced.reduce((lowest, l) => (l.price < lowest.price ? l : lowest));
  }

  return groupListings[0];
}
