import { Loader2 } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { FilterBar, type FilterState } from '@/components/FilterBar';
import { LastUpdated } from '@/components/LastUpdated';
import { ListingCard } from '@/components/ListingCard';
import { Skeleton } from '@/components/ui/skeleton';
import { useIndex } from '@/hooks/useIndex';
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';
import { categorizeListing, categoryRank } from '@/lib/categorize';
import { groupListingsByCanonicalFish } from '@/lib/group-listings';

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

  // Store/availability filters run on individual Listings, same as before
  // grouping was introduced. Filtering is intentionally done BEFORE grouping
  // (not after) — see group-listings.ts — so e.g. a store filter naturally
  // keeps a grouped card iff at least one of its Listings is from that
  // Store, without any group-aware filter logic of its own.
  //
  // Search is the one exception, and deliberately so (issue #74): a plain
  // per-Listing commonName filter applied before grouping — the same
  // pattern used for store/availability — looked right but wasn't, because
  // different Stores title the exact same Canonical Fish differently. See
  // the comment inside the `search` branch below for the full story.
  const filteredListings = useMemo(() => {
    if (!index) return [];
    const search = filters.search.trim().toLowerCase();
    let listings = index.listings;

    if (search) {
      // Match at the Canonical Fish level, not per-Listing (issue #74:
      // "Cory Hastatus" showed "In stock 1/3 stores" via search, when the
      // real count is 2/4). Different Stores title the same Canonical Fish
      // differently — e.g. one Store's Listing is "Cory Hastatus" while
      // another's is just "Tail Spot Pygmy Cory", no "hastatus" in sight —
      // so filtering individual Listings by their own commonName before
      // grouping silently dropped a Store's Listing whenever that Store's
      // title happened not to use the searched word, even though another
      // Listing sharing the exact same canonicalFishId matched. Since
      // group-listings.ts derives storeCount/inStockStoreCount only from
      // the Listings that survive this filter, that under-filtering showed
      // up downstream as an undercounted badge. Fix: first find every
      // canonicalFishId with at least one matching Listing, then keep ALL
      // Listings sharing one of those ids — so the group a card renders
      // from still contains every real Store carrying that fish, exactly
      // like the store filter already does for store-level filtering (see
      // module doc above).
      const matchingFishIds = new Set(
        listings
          .filter((l) => l.commonName.toLowerCase().includes(search))
          .map((l) => l.canonicalFishId),
      );
      listings = listings.filter((l) => matchingFishIds.has(l.canonicalFishId));
    }
    if (filters.storeSlug !== 'all') {
      listings = listings.filter((l) => l.storeSlug === filters.storeSlug);
    }
    if (filters.availability !== 'all') {
      const wantAvailable = filters.availability === 'available';
      listings = listings.filter((l) => l.available === wantAvailable);
    }

    return listings;
  }, [index, filters.search, filters.storeSlug, filters.availability]);

  // One card per Canonical Fish (issue #20): group the filtered Listings by
  // canonicalFishId, then sort groups by:
  //   1. category tier (issue #54) — fish/livestock above plants above
  //      everything else, derived from the group's representative Listing
  //      since that's the same Listing already driving the card's name/
  //      price/image. This runs ahead of availability/price so a cheap,
  //      in-stock accessory (e.g. "Item Customizations" $0.01) can never
  //      outrank a genuine fish the way it could before this sort key
  //      existed.
  //   2. in-stock first (regardless of price direction) within a tier,
  //   3. representative (lowest across Stores) price within an
  //      availability tier.
  // This same pipeline runs for both the default browse order and search
  // results, since search only affects `filteredListings` upstream — so
  // tiering applies identically either way.
  const groups = useMemo(() => {
    const grouped = groupListingsByCanonicalFish(filteredListings);
    // Precompute each group's category rank once (O(n)) instead of calling
    // the (string-scanning, description-fallback) categorizeListing() twice
    // per comparison inside the sort below — a plain Array.sort comparator
    // runs O(n log n) times, which turned "re-sort ~8k groups on every
    // BrowsePage mount" into a multi-second cost on its own, independent of
    // and in addition to the index.json fetch/parse cost fixed by caching
    // in useIndex (issue #60).
    const rankByFishId = new Map<string, number>();
    for (const group of grouped) {
      rankByFishId.set(group.canonicalFishId, categoryRank(categorizeListing(group.representative)));
    }
    return grouped.sort((a, b) => {
      const rankDiff =
        (rankByFishId.get(a.canonicalFishId) ?? 0) - (rankByFishId.get(b.canonicalFishId) ?? 0);
      if (rankDiff !== 0) {
        return rankDiff;
      }
      if (a.available !== b.available) {
        return a.available ? -1 : 1;
      }
      return filters.sort === 'price-asc'
        ? a.representative.price - b.representative.price
        : b.representative.price - a.representative.price;
    });
  }, [filteredListings, filters.sort]);

  function handleFilterChange(next: FilterState) {
    setFilters(next);
    setVisibleCount(PAGE_SIZE);
  }

  const hasMore = visibleCount < groups.length;

  const loadMore = useCallback(() => {
    setVisibleCount((c) => Math.min(c + PAGE_SIZE, groups.length));
  }, [groups.length]);

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
            {groups.length} {groups.length === 1 ? 'fish matches' : 'fish match'}
          </p>

          {groups.length === 0 ? (
            <p className="py-12 text-center text-muted-foreground">No fish match your filters.</p>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {groups.slice(0, visibleCount).map((group) => (
                  <ListingCard
                    key={group.canonicalFishId}
                    listing={group.representative}
                    storeCount={group.storeCount}
                    available={group.available}
                    inStockStoreCount={group.inStockStoreCount}
                  />
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
