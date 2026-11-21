import type { Listing } from '@/types/data';

/**
 * One card's worth of browse-page data: every Listing across Stores that
 * shares a `canonicalFishId` (see docs/adr/0002-canonical-fish-is-species-level.md),
 * collapsed down to a single representative Listing for display.
 */
export interface GroupedListing {
  canonicalFishId: string;
  /** The cheapest Listing in the group — drives the card's price/name/image. */
  representative: Listing;
  /** Every Listing in the group (after upstream filtering), one per Store. */
  listings: Listing[];
  /** Count of distinct Stores carrying this Canonical Fish in `listings`. */
  storeCount: number;
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
    const representative = groupListings.reduce((lowest, l) =>
      l.price < lowest.price ? l : lowest,
    );
    const storeCount = new Set(groupListings.map((l) => l.storeSlug)).size;
    return { canonicalFishId, representative, listings: groupListings, storeCount };
  });
}
