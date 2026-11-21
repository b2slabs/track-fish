import { Loader2 } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { FilterBar, type FilterState } from '@/components/FilterBar';
import { LastUpdated } from '@/components/LastUpdated';
import { ListingCard } from '@/components/ListingCard';
import { Skeleton } from '@/components/ui/skeleton';
import { useIndex } from '@/hooks/useIndex';
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';

const PAGE_SIZE = 24;

const DEFAULT_FILTERS: FilterState = {
  search: '',
  storeSlug: 'all',
  availability: 'all',
  sort: 'price-asc',
};

export function BrowsePage() {
  const { data: index, loading, error } = useIndex();
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const filtered = useMemo(() => {
    if (!index) return [];
    const search = filters.search.trim().toLowerCase();
    let listings = index.listings;

    if (search) {
      listings = listings.filter((l) => l.commonName.toLowerCase().includes(search));
    }
    if (filters.storeSlug !== 'all') {
      listings = listings.filter((l) => l.storeSlug === filters.storeSlug);
    }
    if (filters.availability !== 'all') {
      const wantAvailable = filters.availability === 'available';
      listings = listings.filter((l) => l.available === wantAvailable);
    }

    const sorted = [...listings].sort((a, b) =>
      filters.sort === 'price-asc' ? a.price - b.price : b.price - a.price,
    );
    return sorted;
  }, [index, filters]);

  function handleFilterChange(next: FilterState) {
    setFilters(next);
    setVisibleCount(PAGE_SIZE);
  }

  const hasMore = visibleCount < filtered.length;

  const loadMore = useCallback(() => {
    setVisibleCount((c) => Math.min(c + PAGE_SIZE, filtered.length));
  }, [filtered.length]);

  const { sentinelRef, isLoadingMore } = useInfiniteScroll({
    hasMore,
    onLoadMore: loadMore,
  });

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <header className="mb-6 space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Track Fish</h1>
        <p className="text-muted-foreground">
          Browse fish tracked across aquarium stores, with price and availability history.
        </p>
      </header>

      {loading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-80 w-full" />
          ))}
        </div>
      )}

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          Failed to load live data from the <code>data</code> branch: {error}
        </div>
      )}

      {index && (
        <>
          <div className="mb-6 rounded-lg border bg-card p-4">
            <FilterBar stores={index.stores} value={filters} onChange={handleFilterChange} />
          </div>

          <p className="mb-4 text-sm text-muted-foreground">
            {filtered.length} {filtered.length === 1 ? 'fish matches' : 'fish match'}
          </p>

          {filtered.length === 0 ? (
            <p className="py-12 text-center text-muted-foreground">No fish match your filters.</p>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {filtered.slice(0, visibleCount).map((listing) => (
                  <ListingCard key={listing.listingId} listing={listing} />
                ))}
              </div>
              {hasMore && (
                <div ref={sentinelRef} className="mt-8 flex justify-center py-4">
                  {isLoadingMore && (
                    <span role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      Loading more…
                    </span>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}

      {index && (
        <footer className="mt-10 border-t pt-4">
          <LastUpdated index={index} />
        </footer>
      )}
    </div>
  );
}
