import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { getDisplayName } from '@/lib/display-name';
import { formatPrice } from '@/lib/format';
import { isSoldOutPlaceholder } from '@/lib/listing-freshness';
import type { Listing } from '@/types/data';

/**
 * One Canonical Fish in the browse grid, represented by a single Listing
 * (see group-listings.ts for how it's picked). Deliberately carries no
 * store/website reference — single- and multi-store cards render
 * identically — because a card can represent several Stores at once and
 * naming just one (or linking to just one product page) is misleading
 * (issue #39). Per-store breakdown and buy links live on the fish detail
 * page instead.
 *
 * `storeCount` is how many Stores carry this Canonical Fish in the current
 * filtered view (see group-listings.ts, issue #20). It defaults to 1 so
 * the common single-store case renders exactly as it always has, with no
 * extra badge.
 *
 * `available` reflects whether ANY Listing in the group is in stock
 * (issue #39) — the caller passes `group.available`, not `listing.available`,
 * since `listing` (the representative) may itself be out of stock while a
 * cheaper option from another Store is available.
 *
 * `imageUrl` defaults to `listing.imageUrl` for callers that only have a
 * single Listing in hand, but the browse grid passes
 * `selectPrimaryListing(group.listings)?.imageUrl` explicitly (issue #120)
 * — the same stable rule the fish detail page's header image uses — so a
 * card's photo can no longer disagree with that Canonical Fish's own
 * detail page just because the price-based `representative` Listing
 * happens to carry a different (or no) image.
 */
export function ListingCard({
  listing,
  storeCount = 1,
  available = listing.available,
  inStockStoreCount = available ? 1 : 0,
  imageUrl = listing.imageUrl,
}: {
  listing: Listing;
  storeCount?: number;
  available?: boolean;
  inStockStoreCount?: number;
  imageUrl?: string | null;
}) {
  const detailHref = `/fish/${encodeURIComponent(listing.canonicalFishId)}`;
  // Same name + scientific-name-as-subtitle formatting FishDetailPage uses
  // for its header (issue #91) — both surfaces call this instead of
  // reading `commonName`/`scientificName` off the Listing directly, so
  // they can't drift back apart.
  const displayName = getDisplayName(listing);

  return (
    <Card className="flex flex-col overflow-hidden">
      <Link to={detailHref} className="block">
        <div className="aspect-square w-full overflow-hidden bg-muted">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={displayName.name}
              loading="lazy"
              className="h-full w-full object-cover transition-transform hover:scale-105"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
              No image
            </div>
          )}
        </div>
      </Link>
      <CardHeader className="gap-1 pb-2">
        <Link to={detailHref} className="font-medium leading-snug hover:underline">
          {displayName.name}
        </Link>
        {displayName.scientificName && (
          <p className="text-xs italic text-muted-foreground">{displayName.scientificName}</p>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={inStockStoreCount > 0 ? 'default' : 'destructive'}>
            {storeCount > 1
              ? inStockStoreCount > 0
                ? `In stock ${inStockStoreCount}/${storeCount} stores`
                : `Out of stock ${inStockStoreCount}/${storeCount} stores`
              : available
                ? 'In stock'
                : 'Out of stock'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex-1 pb-2">
        <p className="text-lg font-semibold">
          {isSoldOutPlaceholder(listing.price) ? (
            // issue #86: last-resort case — every Listing in the group is
            // priced at the $0.00 sold-out placeholder, so there's no real
            // price anywhere to show "From" (group-listings.ts's
            // pickRepresentative falls back to just the first Listing here).
            'Price unavailable'
          ) : (
            <>
              {storeCount > 1 ? 'From ' : ''}
              {formatPrice(listing.price, listing.currency)}
            </>
          )}
        </p>
        {listing.variants.length > 1 &&
          (() => {
            // issue #86: a variant priced at the $0.00 sold-out placeholder
            // must never leak into this "from $X" figure — skip it the same
            // way `group-listings.ts`'s representative-picking already does
            // at the Listing level.
            const realPrices = listing.variants
              .map((v) => v.price)
              .filter((p) => !isSoldOutPlaceholder(p));
            if (realPrices.length === 0) return null;
            return (
              <p className="text-xs text-muted-foreground">
                {listing.variants.length} variants · from{' '}
                {formatPrice(Math.min(...realPrices), listing.currency)}
              </p>
            );
          })()}
      </CardContent>
    </Card>
  );
}
