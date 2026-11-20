/**
 * The primary defense against silently corrupting history when a store's
 * site structure changes under us (PRD "Architecture > Scraping"): a
 * Scrape Run is rejected outright if its parsed Listing count drops more
 * than ~50% versus the Store's last successful run.
 */
export function passesSafetyNetCheck(
  newListingCount: number,
  previousListingCount: number | undefined
): boolean {
  if (previousListingCount === undefined || previousListingCount <= 0) {
    // No prior successful run to compare against — nothing to protect yet.
    return true;
  }

  const dropRatio = (previousListingCount - newListingCount) / previousListingCount;
  return dropRatio <= 0.5;
}
