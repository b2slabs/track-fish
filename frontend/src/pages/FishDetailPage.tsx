import { ArrowLeft } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { LastUpdated } from '@/components/LastUpdated';
import { PriceHistoryChart } from '@/components/PriceHistoryChart';
import { StoreComparisonCard } from '@/components/StoreComparisonCard';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useFishHistory } from '@/hooks/useFishHistory';
import { useIndex } from '@/hooks/useIndex';

export function FishDetailPage() {
  const { canonicalFishId: rawId } = useParams<{ canonicalFishId: string }>();
  const canonicalFishId = rawId ? decodeURIComponent(rawId) : undefined;

  const { data: index, loading: indexLoading, error: indexError } = useIndex();
  const { data: history, loading: historyLoading, error: historyError } =
    useFishHistory(canonicalFishId);

  // A Canonical Fish is species-level (see ADR 0002) — it can have one
  // Listing per Store that carries it. Filter (not find) so the page shows
  // every Store side by side, however many there are.
  const listings = index?.listings.filter((l) => l.canonicalFishId === canonicalFishId) ?? [];
  // Use whichever Listing has an image for the header; all share one species.
  const primary = listings.find((l) => l.imageUrl) ?? listings[0];
  const loading = indexLoading || historyLoading;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <Link
        to="/"
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground hover:underline"
      >
        <ArrowLeft className="size-4" /> Back to browse
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

      {primary && history && (
        <div className="mt-6 space-y-6">
          <Card>
            <div className="flex flex-col gap-4 p-4 sm:flex-row">
              <div className="aspect-square w-full overflow-hidden rounded-md bg-muted sm:w-48">
                {primary.imageUrl ? (
                  <img
                    src={primary.imageUrl}
                    alt={primary.commonName}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                    No image
                  </div>
                )}
              </div>
              <div className="flex-1 space-y-2">
                <h1 className="text-2xl font-semibold leading-tight">{primary.commonName}</h1>
                {primary.scientificName && (
                  <p className="text-sm italic text-muted-foreground">
                    {primary.scientificName}
                  </p>
                )}
                <p className="text-sm text-muted-foreground">
                  Tracked at {listings.length} store{listings.length === 1 ? '' : 's'}
                </p>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="text-lg font-semibold">Price &amp; availability by store</h2>
              <p className="text-sm text-muted-foreground">
                Size/grade is shown next to each price — Listings at different sizes are not
                directly comparable (see ADR 0002).
              </p>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2">
                {listings.map((l) => (
                  <StoreComparisonCard key={l.listingId} listing={l} />
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
                  through unfiltered and let the chart split by listingId itself. */}
              <PriceHistoryChart
                events={history.events}
                listings={listings.map((l) => ({
                  listingId: l.listingId,
                  storeSlug: l.storeSlug,
                  storeName: l.storeName,
                  commonName: l.commonName,
                  currency: l.currency,
                }))}
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
