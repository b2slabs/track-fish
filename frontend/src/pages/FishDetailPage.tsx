import { ArrowLeft, ExternalLink } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { LastUpdated } from '@/components/LastUpdated';
import { PriceHistoryChart } from '@/components/PriceHistoryChart';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useFishHistory } from '@/hooks/useFishHistory';
import { useIndex } from '@/hooks/useIndex';
import { formatDateTime, formatPrice } from '@/lib/format';

export function FishDetailPage() {
  const { canonicalFishId: rawId } = useParams<{ canonicalFishId: string }>();
  const canonicalFishId = rawId ? decodeURIComponent(rawId) : undefined;

  const { data: index, loading: indexLoading, error: indexError } = useIndex();
  const { data: history, loading: historyLoading, error: historyError } =
    useFishHistory(canonicalFishId);

  const listing = index?.listings.find((l) => l.canonicalFishId === canonicalFishId);
  const loading = indexLoading || historyLoading;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <Link
        to="/"
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground hover:underline"
      >
        <ArrowLeft className="size-4" /> Back to browse
      </Link>

      {index && <LastUpdated index={index} />}

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

      {!loading && !indexError && !listing && (
        <p className="mt-6 text-muted-foreground">
          This fish is not in the current index — it may have been removed from the tracked
          catalog.
        </p>
      )}

      {listing && history && (
        <div className="mt-6 space-y-6">
          <Card>
            <div className="flex flex-col gap-4 p-4 sm:flex-row">
              <div className="aspect-square w-full overflow-hidden rounded-md bg-muted sm:w-48">
                {listing.imageUrl ? (
                  <img
                    src={listing.imageUrl}
                    alt={listing.commonName}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                    No image
                  </div>
                )}
              </div>
              <div className="flex-1 space-y-2">
                <h1 className="text-2xl font-semibold leading-tight">{listing.commonName}</h1>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{listing.storeName}</Badge>
                  <Badge variant={listing.available ? 'default' : 'outline'}>
                    {listing.available ? 'In stock' : 'Out of stock'}
                  </Badge>
                </div>
                <p className="text-xl font-semibold">
                  {formatPrice(listing.price, listing.currency)}
                </p>
                {listing.variants.length > 1 && (
                  <ul className="text-sm text-muted-foreground">
                    {listing.variants.map((v) => (
                      <li key={v.id}>
                        {v.label}: {formatPrice(v.price, listing.currency)}{' '}
                        {v.available ? '' : '(out of stock)'}
                      </li>
                    ))}
                  </ul>
                )}
                <a
                  href={listing.productUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                >
                  View on {listing.storeName}
                  <ExternalLink className="size-3.5" />
                </a>
                <p className="text-xs text-muted-foreground">
                  First observed {formatDateTime(listing.firstObservedAt)} · Last observed{' '}
                  {formatDateTime(listing.lastObservedAt)}
                </p>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="text-lg font-semibold">Price &amp; availability history</h2>
            </CardHeader>
            <CardContent>
              <PriceHistoryChart events={history.events} currency={listing.currency} />
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
