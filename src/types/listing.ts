/**
 * A single Listing variant — one size/grade option on a Shopify product.
 * See GLOSSARY.md: "variants" are part of a Listing, not a separate identity.
 */
export interface ListingVariant {
  /** The store platform's own variant identifier, stringified. */
  id: string;
  /** Size/grade label, e.g. "Small", "Blue Green Emerald / Dream Blue Velvet". */
  label: string;
  price: number;
  available: boolean;
}

/**
 * The result of parsing one Store's raw archived snapshot into a single
 * product entry, before any Canonical Fish assignment or observation
 * bookkeeping is layered on.
 */
export interface ParsedListing {
  /** The Store platform's own product identifier, stringified. */
  productIdentifier: string;
  commonName: string;
  /** Plain-text description (HTML stripped). */
  description: string;
  productUrl: string;
  imageUrl: string | null;
  currency: string;
  /** Representative price: the lowest price among in-stock variants, falling back to the lowest price overall if none are in stock. */
  price: number;
  /** True if at least one variant is in stock. */
  available: boolean;
  variants: ListingVariant[];
}

/**
 * A Listing as tracked in the processed layer: a ParsedListing plus identity
 * (Listing id, Canonical Fish id) and first/last-observed bookkeeping.
 */
export interface Listing extends ParsedListing {
  /** Stable id for this Listing: `${storeSlug}:${productIdentifier}`. */
  listingId: string;
  storeSlug: string;
  storeName: string;
  /**
   * The cross-store fish identity this Listing is grouped under. For a
   * single configured Store there is no real cross-store matching yet
   * (see issue #3), so this is a trivial 1:1 mapping onto the Listing —
   * but it is a distinct id namespace (`cf:...`) so that #3 can later
   * repoint it without changing listingId or any already-written history.
   */
  canonicalFishId: string;
  /** ISO timestamp of the first Scrape Run this Listing was observed in. */
  firstObservedAt: string;
  /** ISO timestamp of the most recent Scrape Run this Listing was observed in. */
  lastObservedAt: string;
}

export type HistoryEventType = 'change' | 'heartbeat';

/**
 * One entry in a Canonical Fish's history file: either a Change Event
 * (price or availability differed from the prior Scrape Run) or a
 * Heartbeat (observed, unchanged).
 */
export interface HistoryEvent {
  type: HistoryEventType;
  observedAt: string;
  price: number;
  currency: string;
  available: boolean;
  variants: ListingVariant[];
  /**
   * Present only on 'change' events. One or more of: 'first-observed'
   * (no prior state existed), 'price', 'available', 'variants'.
   */
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

/**
 * The processed layer's `index.json`: every current Listing across every
 * configured Store, plus per-Store bookkeeping used by the safety-net
 * validation guard.
 */
export interface IndexFile {
  generatedAt: string;
  stores: Record<string, StoreIndexMeta>;
  listings: Listing[];
}
