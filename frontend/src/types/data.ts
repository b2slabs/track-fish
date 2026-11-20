/**
 * Mirrors the processed-layer shapes defined in `src/types/listing.ts` on
 * `main`. Kept as a plain copy (rather than imported across packages)
 * because the frontend is a separate npm project that only ever reads this
 * JSON over HTTP — see docs/adr/0003-processed-data-as-static-json-fetched-live.md.
 */

export interface ListingVariant {
  id: string;
  label: string;
  price: number;
  available: boolean;
}

export interface Listing {
  productIdentifier: string;
  commonName: string;
  description: string;
  productUrl: string;
  imageUrl: string | null;
  currency: string;
  price: number;
  available: boolean;
  variants: ListingVariant[];
  listingId: string;
  storeSlug: string;
  storeName: string;
  canonicalFishId: string;
  firstObservedAt: string;
  lastObservedAt: string;
}

export type HistoryEventType = 'change' | 'heartbeat';

export interface HistoryEvent {
  type: HistoryEventType;
  observedAt: string;
  price: number;
  currency: string;
  available: boolean;
  variants: ListingVariant[];
  changedFields?: string[];
}

export interface CanonicalFishHistory {
  canonicalFishId: string;
  listingId: string;
  storeSlug: string;
  commonName: string;
  events: HistoryEvent[];
}

export interface StoreIndexMeta {
  name: string;
  domain: string;
  lastSuccessfulRunAt: string;
  lastSuccessfulListingCount: number;
}

export interface IndexFile {
  generatedAt: string;
  stores: Record<string, StoreIndexMeta>;
  listings: Listing[];
}
