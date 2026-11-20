import type { Listing, ParsedListing } from '../types/listing.js';

/**
 * Builds the stable identity pair for a Listing: the Listing id (tied to
 * the Store's own product identifier) and the Canonical Fish id it is
 * grouped under.
 *
 * For a single configured Store, Canonical Fish identity is trivially 1:1
 * per Listing — real cross-store matching (by scientific name, fuzzy
 * common-name, and manual mapping) is issue #3. The `cf:` prefix keeps
 * Canonical Fish ids in a distinct namespace from Listing ids on purpose,
 * so #3 can later repoint a Listing at a shared Canonical Fish without
 * changing the Listing id or disturbing any history already written
 * under the old Canonical Fish id.
 */
export function assignCanonicalFish(storeSlug: string, productIdentifier: string) {
  const listingId = `${storeSlug}:${productIdentifier}`;
  const canonicalFishId = `cf:${storeSlug}:${productIdentifier}`;
  return { listingId, canonicalFishId };
}

/**
 * Turns a ParsedListing into a tracked Listing: assigns identity, and
 * carries forward `firstObservedAt` from the previous record (or sets it
 * to `now` if this is the first time the Listing has been seen).
 */
export function buildListingRecord(
  parsed: ParsedListing,
  store: { slug: string; name: string },
  now: string,
  previous: Listing | undefined
): Listing {
  const { listingId, canonicalFishId } = assignCanonicalFish(store.slug, parsed.productIdentifier);

  return {
    ...parsed,
    listingId,
    storeSlug: store.slug,
    storeName: store.name,
    canonicalFishId,
    firstObservedAt: previous?.firstObservedAt ?? now,
    lastObservedAt: now,
  };
}
