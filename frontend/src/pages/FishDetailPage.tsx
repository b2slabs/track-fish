import { ArrowLeft } from 'lucide-react';
import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { LastUpdated } from '@/components/LastUpdated';
import { PriceHistoryChart } from '@/components/PriceHistoryChart';
import { StoreComparisonCard } from '@/components/StoreComparisonCard';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useFishHistory } from '@/hooks/useFishHistory';
import { useIndex } from '@/hooks/useIndex';
import { getDisplayName } from '@/lib/display-name';
import { pickRepresentative } from '@/lib/group-listings';
import { selectPrimaryListing } from '@/lib/select-primary-image';

export function FishDetailPage() {
  const { canonicalFishId: rawId } = useParams<{ canonicalFishId: string }>();
  const canonicalFishId = rawId ? decodeURIComponent(rawId) : undefined;

  const { data: index, loading: indexLoading, error: indexError } = useIndex();
  const { data: history, loading: historyLoading, error: historyError } =
    useFishHistory(canonicalFishId);

  // A Canonical Fish is species-level (see ADR 0002). A Store can carry more
  // than one Listing for it (e.g. a "School of 6" and a "Single" as separate
  // Shopify products — see issue #56), so `listings.length` is a Listing
  // count, not a Store count. Filter (not find) so the page shows every
  // Listing side by side, however many there are.
  const listings = index?.listings.filter((l) => l.canonicalFishId === canonicalFishId) ?? [];
  const storeCount = new Set(listings.map((l) => l.storeSlug)).size;
  // Image and name are deliberately picked by two different, independently
  // documented rules rather than one "primary" Listing serving both (as it
  // used to): the image uses selectPrimaryListing's stable, firstObservedAt-
  // ordered rule (issue #92) so it doesn't flicker as new Listings merge in,
  // while the name/scientific-name subtitle use group-listings.ts's
  // pickRepresentative (issue #91) -- the same rule the browse grid's card
  // uses -- so this page can no longer show a different common name than
  // search results for the same Canonical Fish just because the two pages
  // happened to pick different Listings to read a name off of.
  const image = selectPrimaryListing(listings);
  const primary =
    listings.length > 0 ? pickRepresentative(listings, index?.stores ?? {}) : undefined;
  const displayName = primary ? getDisplayName(primary) : undefined;
  const loading = indexLoading || historyLoading;

  useEffect(() => {
    document.title = displayName ? `${displayName.name} - Track Fish` : 'Track Fish';
    return () => {
      document.title = 'Track Fish';
    };
  }, [displayName]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <Link
        to="/"
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground hover:underline"
      >
        <ArrowLeft className="size-4" /> Back
      </Link>

      {loading && (
        <div className="mt-6 space-y-4">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-72 w-full" />
        </div>
      )}

      {(indexError || historyError) && (
        <div className="mt-6 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          Failed to load live data from the <code>data</code> branch:{' '}
          {indexError ?? historyError}
        </div>
      )}

      {!loading && !indexError && listings.length === 0 && (
        <p className="mt-6 text-muted-foreground">
          This fish is not in the current index — it may have been removed from the tracked
          catalog.
        </p>
      )}

      {primary && displayName && history && (
        <div className="mt-6 space-y-6">
          <Card>
            <div className="flex flex-col gap-4 p-4 sm:flex-row">
              <div className="aspect-square w-full overflow-hidden rounded-md bg-muted sm:w-48">
                {image?.imageUrl ? (
                  <img
                    src={image.imageUrl}
                    alt={displayName.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                    No image
                  </div>
                )}
              </div>
              <div className="flex-1 space-y-2">
                <h1 className="text-2xl font-semibold leading-tight">{displayName.name}</h1>
                {displayName.scientificName && (
                  <p className="text-sm italic text-muted-foreground">
                    {displayName.scientificName}
                  </p>
                )}
                <p className="text-sm text-muted-foreground">
                  Tracked at {storeCount} store{storeCount === 1 ? '' : 's'}
                </p>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="text-lg font-semibold">Price &amp; availability by store</h2>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2">
                {listings.map((l) => (
                  <StoreComparisonCard key={l.listingId} listing={l} stores={index!.stores} />
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="text-lg font-semibold">Price History</h2>
            </CardHeader>
            <CardContent>
              {/* The shared history file interleaves events from every Store's
                  Listing (and, for a Canonical Fish with multiple Listings, this
                  chart renders them as one unified set of series rather than N
                  separate per-Store charts — issue #23) — pass every event
                  through unfiltered and let the chart split by listingId itself.
                  lastCheckedAt (issue #81) lives on the history file's own
                  per-Listing metadata, not on index.json's Listing — matched
                  in here by listingId rather than carried by `listings` (the
                  index.json entries) itself. */}
              <PriceHistoryChart
                events={history.events}
                listings={listings.map((l) => {
                  const historyListing = history.listings.find((hl) => hl.listingId === l.listingId);
                  return {
                    listingId: l.listingId,
                    storeSlug: l.storeSlug,
                    storeName: l.storeName,
                    commonName: l.commonName,
                    currency: l.currency,
                    // Falls back to this Listing's own lastObservedAt (always
                    // present on index.json) on the off chance the history
                    // file hasn't caught up yet -- e.g. a brand-new Listing
                    // whose first history write raced this page's two fetches.
                    lastCheckedAt: historyListing?.lastCheckedAt ?? l.lastObservedAt,
                    // Current availability straight from index.json (issue
                    // #88) -- always the live picture, unlike any single
                    // HistoryEvent's own `available`, which only ever speaks
                    // to that one past instant.
                    available: l.available,
                  };
                })}
              />
            </CardContent>
          </Card>
        </div>
      )}

      {index && (
        <footer className="mt-10 border-t pt-4">
          <LastUpdated index={index} />
        </footer>
      )}
    </div>
  );
}
