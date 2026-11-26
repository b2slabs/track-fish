import { ExternalLink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { formatPrice, formatShortDate, normalizeVariantLabel } from '@/lib/format';
import { displayListingStatus, isSoldOutPlaceholder, type FreshnessStore } from '@/lib/listing-freshness';
import type { Listing } from '@/types/data';

/**
 * One Store's current price, availability, and size/grade for a Canonical
 * Fish — rendered side by side with every other Store carrying it on the
 * fish detail page.
 *
 * Per ADR 0002 (canonical-fish-is-species-level.md), a Canonical Fish groups
 * Listings at the species level only; size/grade is a property of each
 * Listing's variants. Every variant's size/grade label is always shown
 * next to its price here — even when a Listing has just one variant — so
 * two Stores' prices are never misread as a direct apples-to-apples
 * comparison when they're actually for different sizes.
 *
 * `stores` (`IndexFile.stores`) feeds `displayListingStatus` (issue #86) so
 * this Listing's own badge reads "Out of stock" rather than an unqualified
 * "In stock" once it's stale (vanished from this Store's catalog, or the
 * Store's own data just old) — same stale/placeholder-aware rule every
 * other display surface uses, not `listing.available` read raw.
 */
export function StoreComparisonCard({
  listing,
  stores,
}: {
  listing: Listing;
  stores: Record<string, FreshnessStore>;
}) {
  const status = displayListingStatus(listing, stores, new Date());
  return (
    <Card className="flex flex-col">
      <CardHeader className="gap-1 pb-2">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium">{listing.storeName}</span>
          <Badge variant={status.available ? 'default' : 'outline'}>
            {status.available ? 'In stock' : 'Out of stock'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex-1 space-y-3">
        <ul className="space-y-1 text-sm">
          {listing.variants.map((v) => (
            <li key={v.id} className="flex items-baseline justify-between gap-3">
              <span className="text-muted-foreground">
                {normalizeVariantLabel(v.label, listing.variants.length)}
              </span>
              <span
                className={
                  v.available && !isSoldOutPlaceholder(v.price)
                    ? 'font-medium'
                    : 'font-medium text-muted-foreground line-through'
                }
              >
                {isSoldOutPlaceholder(v.price) ? 'Sold out' : formatPrice(v.price, listing.currency)}
              </span>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between gap-2">
          <a
            href={listing.productUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
          >
            View on {listing.storeName}
            <ExternalLink className="size-3.5" />
          </a>
          <span className="text-xs text-muted-foreground">
            {formatShortDate(listing.lastObservedAt)}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
