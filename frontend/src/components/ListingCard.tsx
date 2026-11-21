import { ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { formatPrice } from '@/lib/format';
import type { Listing } from '@/types/data';

/**
 * One Canonical Fish in the browse grid, represented by its cheapest
 * Listing. Links to the original store product page directly, and uses
 * that store's own hotlinked image URL (never mirrored) — per GLOSSARY.md
 * and docs/adr/0003.
 *
 * `storeCount` is how many Stores carry this Canonical Fish in the current
 * filtered view (see group-listings.ts, issue #20). It defaults to 1 so
 * the common single-store case renders exactly as it always has, with no
 * extra badge.
 */
export function ListingCard({
  listing,
  storeCount = 1,
}: {
  listing: Listing;
  storeCount?: number;
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
          <Badge variant="secondary">{listing.storeName}</Badge>
          <Badge variant={listing.available ? 'default' : 'outline'}>
            {listing.available ? 'In stock' : 'Out of stock'}
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
      <CardFooter className="flex items-center justify-between gap-2 pt-0">
        <Link to={detailHref} className="text-sm text-muted-foreground hover:underline">
          Price history
        </Link>
        <a
          href={listing.productUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          View on {listing.storeName}
          <ExternalLink className="size-3.5" />
        </a>
      </CardFooter>
    </Card>
  );
}
