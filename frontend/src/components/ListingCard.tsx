import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { formatPrice } from '@/lib/format';
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
 */
export function ListingCard({
  listing,
  storeCount = 1,
  available = listing.available,
}: {
  listing: Listing;
  storeCount?: number;
  available?: boolean;
}) {
  const detailHref = `/fish/${encodeURIComponent(listing.canonicalFishId)}`;

  return (
    <Card className="flex flex-col overflow-hidden">
      <Link to={detailHref} className="block">
        <div className="aspect-square w-full overflow-hidden bg-muted">
          {listing.imageUrl ? (
            <img
              src={listing.imageUrl}
              alt={listing.commonName}
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
          {listing.commonName}
        </Link>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={available ? 'default' : 'outline'}>
            {available ? 'In stock' : 'Out of stock'}
          </Badge>
          {storeCount > 1 && (
            <Badge variant="outline" className="border-primary/40 text-primary">
              Available at {storeCount} stores
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex-1 pb-2">
        <p className="text-lg font-semibold">
          {storeCount > 1 ? 'From ' : ''}
          {formatPrice(listing.price, listing.currency)}
        </p>
        {listing.variants.length > 1 && (
          <p className="text-xs text-muted-foreground">
            {listing.variants.length} variants · from{' '}
            {formatPrice(Math.min(...listing.variants.map((v) => v.price)), listing.currency)}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
