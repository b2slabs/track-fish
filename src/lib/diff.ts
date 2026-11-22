import type { Listing, ListingVariant, HistoryEvent } from '../types/listing.js';

/**
 * Compares a Listing's new state against its previously known state and
 * produces the HistoryEvent to append to that Canonical Fish's history
 * file: a Change Event when price or availability (at the Listing level
 * or on any individual variant) differs, or `undefined` when nothing
 * changed. An unchanged observation gets no event at all (see issue #81)
 * — the caller (`processStoreRun`) updates that Listing's `lastCheckedAt`
 * on the history file instead of appending anything here, which is what
 * keeps this array growing only on real changes.
 *
 * `previous` is undefined the first time a Listing is observed; that is
 * itself recorded as a Change Event (reason 'first-observed') so a
 * Canonical Fish's history always starts with a concrete data point
 * rather than an empty file.
 */
export function diffListing(previous: Listing | undefined, next: Listing): HistoryEvent | undefined {
  const base = {
    observedAt: next.lastObservedAt,
    price: next.price,
    currency: next.currency,
    available: next.available,
    variants: next.variants,
  };

  if (!previous) {
    return { ...base, type: 'change', changedFields: ['first-observed'] };
  }

  const changedFields: string[] = [];
  if (previous.price !== next.price) {
    changedFields.push('price');
  }
  if (previous.available !== next.available) {
    changedFields.push('available');
  }
  if (variantsDiffer(previous.variants, next.variants)) {
    changedFields.push('variants');
  }

  if (changedFields.length > 0) {
    return { ...base, type: 'change', changedFields };
  }

  return undefined;
}

function variantsDiffer(previous: ListingVariant[], next: ListingVariant[]): boolean {
  if (previous.length !== next.length) {
    return true;
  }

  const previousById = new Map(previous.map((variant) => [variant.id, variant]));

  for (const variant of next) {
    const match = previousById.get(variant.id);
    if (!match || match.price !== variant.price || match.available !== variant.available) {
      return true;
    }
  }

  return false;
}
