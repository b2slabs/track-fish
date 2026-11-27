import type { Listing } from '@/types/data';

/**
 * Picks the Listing whose image/name represent a Canonical Fish on its
 * detail page (issue #92).
 *
 * The fish detail page used to show `listings.find((l) => l.imageUrl) ??
 * listings[0]` — whichever image-bearing Listing happened to come first in
 * `index.json`'s array. That order isn't a documented contract (see
 * `group-listings.ts`'s own representative-picking for the equivalent
 * problem on the browse page), so as new Listings merged in and the array
 * was rebuilt, the "first" Listing could silently change and the header
 * image would flicker to a different Store's photo for no reason a reader
 * could point to.
 *
 * Rule: among Listings with a non-null `imageUrl`, pick the one with the
 * earliest `firstObservedAt` (ties broken by `listingId` ascending, for a
 * total order when two Listings were first observed in the same Scrape
 * Run). `firstObservedAt` is set once when a Listing first appears and
 * never changes afterwards, so this is stable under merges: a brand-new
 * Listing always has a *later* `firstObservedAt` than any Listing already
 * on the page, so it can never bump an already-established primary image.
 * The only time the primary image changes is the first time an
 * image-bearing Listing appears for a Canonical Fish that previously had
 * none — a change that IS tied to the rule.
 *
 * Falls back to the earliest-`firstObservedAt` Listing overall (same
 * tie-break) when no Listing has an image, so the header still has a name
 * to show; falls back to `undefined` only when `listings` is empty.
 */
export function selectPrimaryListing(listings: Listing[]): Listing | undefined {
  if (listings.length === 0) return undefined;

  const withImage = listings.filter((l) => l.imageUrl);
  const candidates = withImage.length > 0 ? withImage : listings;

  return candidates.reduce((earliest, l) => {
    if (l.firstObservedAt < earliest.firstObservedAt) return l;
    if (l.firstObservedAt > earliest.firstObservedAt) return earliest;
    return l.listingId < earliest.listingId ? l : earliest;
  });
}

/**
 * Every distinct image URL across a Canonical Fish's Listings (issue
 * #120), for the detail page's gallery — ordered the same way
 * `selectPrimaryListing` picks its one image (earliest `firstObservedAt`
 * first, ties broken by `listingId`), so the gallery's first thumbnail is
 * always that same primary image. Two Listings sharing the identical
 * image URL (a common Store-sourced stock photo) contribute only one
 * entry. Empty when no Listing has an image.
 */
export function listGalleryImageUrls(listings: Listing[]): string[] {
  const ordered = [...listings]
    .filter((l): l is Listing & { imageUrl: string } => !!l.imageUrl)
    .sort((a, b) => {
      if (a.firstObservedAt < b.firstObservedAt) return -1;
      if (a.firstObservedAt > b.firstObservedAt) return 1;
      return a.listingId < b.listingId ? -1 : a.listingId > b.listingId ? 1 : 0;
    });

  const seen = new Set<string>();
  const urls: string[] = [];
  for (const l of ordered) {
    if (seen.has(l.imageUrl)) continue;
    seen.add(l.imageUrl);
    urls.push(l.imageUrl);
  }
  return urls;
}
