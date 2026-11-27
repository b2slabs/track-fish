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
   * The cross-store fish identity this Listing is grouped under (see
   * issue #3 / `src/lib/canonical-fish.ts`): a manual override, a
   * scientific-name match, a confident fuzzy common-name match, or —
   * when none of those apply — a trivial `cf:${storeSlug}:${productIdentifier}`
   * id namespaced to this Listing alone, so a later run can repoint it at
   * a shared id without changing listingId or losing history already
   * written under the old id (see `repointListingHistory`).
   */
  canonicalFishId: string;
  /**
   * The scientific name extracted from this Listing's title/description
   * (see `src/lib/scientific-name.ts`), normalized to "Genus species"
   * form, or null if none could be confidently extracted. Two Listings
   * with the same scientificName are always matched to the same
   * Canonical Fish, regardless of Store.
   */
  scientificName: string | null;
  /** ISO timestamp of the first Scrape Run this Listing was observed in. */
  firstObservedAt: string;
  /** ISO timestamp of the most recent Scrape Run this Listing was observed in. */
  lastObservedAt: string;
}

export type HistoryEventType = 'change';

/**
 * One entry in a Canonical Fish's history file: a Change Event (price or
 * availability differed from the prior Scrape Run). An unchanged
 * observation does NOT get an entry here — see issue #81 /
 * `CanonicalFishHistoryListing.lastCheckedAt` below, which an unchanged
 * observation updates in place instead. (Before issue #81, an unchanged
 * observation appended a `type: 'heartbeat'` entry to this array every
 * single day — one more than real changes by orders of magnitude — which
 * is exactly what made this array grow unboundedly; see
 * `docs/adr/0005-heartbeat-events-replaced-by-lastcheckedat.md`.)
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
  /**
   * Issue #113: the Listing's own `lastCheckedAt` as of immediately before
   * this Change Event overwrote it, when that's later than the previous
   * Change Event's own `observedAt` -- i.e. there were one or more days
   * where this Listing was re-observed with no real change (issue #81: an
   * unchanged day never gets its own event, only `lastCheckedAt` advances)
   * before the change this event actually records. Without this, once
   * `lastCheckedAt` is overwritten by this event, there is no remaining
   * record that the Listing was confirmed unchanged any later than its
   * previous real event -- the chart would otherwise have to draw as if
   * the change happened immediately after that previous event, which can
   * be misleading by days or weeks. Absent when there's no previous event
   * to compare against (a `first-observed` event), or when this change
   * happened with no intervening confirmed-unchanged day.
   */
  confirmedSameUntil?: string;
}

/**
 * A HistoryEvent as stored in a Canonical Fish's history file, tagged
 * with which Listing (and Store) produced it. This tagging only matters
 * once a history file can carry events from more than one Listing (see
 * issue #3) — without it, interleaved events from two merged Listings
 * would be indistinguishable.
 */
export interface CanonicalFishHistoryEvent extends HistoryEvent {
  listingId: string;
  storeSlug: string;
}

/** One Listing contributing to a Canonical Fish's history, for display. */
export interface CanonicalFishHistoryListing {
  listingId: string;
  storeSlug: string;
  storeName: string;
  commonName: string;
  /**
   * ISO timestamp of the most recent Scrape Run that observed this
   * Listing, updated in place on every observation — whether or not
   * anything changed (see issue #81). This is the authoritative "confirmed
   * observed through this date" signal: it is what lets the frontend chart
   * extend a variant's line flat from its last Change Event up to this
   * date, instead of needing a dense trail of Heartbeat events (or a
   * cadence-based heuristic guess, issues #53/#59) to know how far a line
   * can safely be drawn before assuming a silent gap means something.
   */
  lastCheckedAt: string;
}

export interface CanonicalFishHistory {
  canonicalFishId: string;
  /** Representative common name for display — the common name of
   * whichever Listing most recently contributed an event. */
  commonName: string;
  /** The scientific name this Canonical Fish was matched on, if any.
   * Null when the match (if any) was fuzzy, manual, or there is none yet. */
  scientificName: string | null;
  /** Every Listing (across every Store) that has ever contributed an
   * event to this Canonical Fish's history. */
  listings: CanonicalFishHistoryListing[];
  events: CanonicalFishHistoryEvent[];
}

/**
 * A Listing whose best automatic Canonical Fish match (see
 * `src/lib/canonical-fish.ts`) was ambiguous — confident enough to
 * record, not confident enough to auto-merge. Persisted to
 * `pending-matches.json` in the `data` branch for a maintainer to
 * resolve via `src/config/canonical-fish-overrides.ts`. Entries are
 * recomputed fresh each time their Listing's Store is processed, so a
 * resolved or no-longer-ambiguous entry disappears on its own.
 */
export interface PendingMatch {
  listingId: string;
  storeSlug: string;
  commonName: string;
  candidateCanonicalFishId: string;
  candidateCommonName: string;
  /** Fuzzy common-name similarity score, in [0, 1]. */
  score: number;
  firstDetectedAt: string;
  lastDetectedAt: string;
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
