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
  /** Present when matched by scientific name; null for curated/common-name-only matches. */
  scientificName?: string | null;
  firstObservedAt: string;
  lastObservedAt: string;
}

export type HistoryEventType = 'change';

export interface HistoryEvent {
  type: HistoryEventType;
  observedAt: string;
  price: number;
  currency: string;
  available: boolean;
  variants: ListingVariant[];
  changedFields?: string[];
  /**
   * The Listing's own `lastCheckedAt` as of immediately before this event
   * overwrote it, when later than the previous event's own `observedAt`
   * (issue #113) — i.e. there was at least one confirmed-unchanged day
   * between the previous real event and this one. Lets the chart draw
   * color through that date instead of collapsing straight to this
   * event's own date once a gap appears.
   */
  confirmedSameUntil?: string;
  /**
   * Which Listing this event belongs to. A Canonical Fish's history file
   * interleaves events from every Store's Listing in one array (see
   * docs/adr/0002-canonical-fish-is-species-level.md) — consumers must
   * filter by `listingId`/`storeSlug` before treating a sequence of events
   * as one continuous price trend.
   */
  listingId: string;
  storeSlug: string;
}

/** One Store's Listing contributing to a Canonical Fish's shared history file. */
export interface CanonicalFishHistoryListing {
  listingId: string;
  storeSlug: string;
  storeName: string;
  commonName: string;
  /**
   * ISO timestamp of the most recent Scrape Run that observed this
   * Listing, updated in place on every observation whether or not
   * anything changed (issue #81). The chart extends a variant's line flat
   * from its last Change Event up to this date instead of needing a
   * dense trail of Heartbeat events (or a cadence heuristic) to know how
   * far it's safe to draw.
   */
  lastCheckedAt: string;
}

export interface CanonicalFishHistory {
  canonicalFishId: string;
  commonName: string;
  scientificName?: string | null;
  /** Every Store's Listing that has contributed events to this file so far. */
  listings: CanonicalFishHistoryListing[];
  /** Events from every Listing above, interleaved — filter by `listingId` per Store. */
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
