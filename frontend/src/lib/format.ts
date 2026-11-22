export function formatPrice(price: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
    }).format(price);
  } catch {
    return `$${price.toFixed(2)}`;
  }
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(date);
}

/** Compact "21 Nov 2026" style date, no time — for small/secondary UI text. */
export function formatShortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(
    date,
  );
}

/**
 * Shopify gives a product with exactly one variant the literal placeholder
 * option value "Title" — a raw internal label, not a real size/grade, that
 * otherwise leaks straight through to the UI unchanged (issue #42). Every
 * place that renders a variant list reads the same underlying
 * `ListingVariant.label` — `StoreComparisonCard`'s per-Listing list and
 * `PriceHistoryChart`'s per-Store tooltip breakdown both call this instead
 * of rendering `label` raw, so the fix lives in one shared place rather
 * than two special-cased ones.
 *
 * `siblingCount` is the number of variants Shopify actually gave the one
 * product this label's own variant came from (e.g. `listing.variants.length`
 * for a straightforward per-Listing render like `StoreComparisonCard`'s).
 * The placeholder is only ever genuine when that count is exactly one — a
 * real multi-variant listing's option values are left untouched even if one
 * happened to also be the literal string "Title".
 *
 * Callers that pool variants from more than one HistoryEvent/Listing into
 * one rendered list (e.g. `PriceHistoryChart`'s per-instant tooltip, which
 * can combine two Listings a Store still carries for the same Canonical
 * Fish into one point) must pass each variant's OWN originating event's
 * variant count here, not the size of the pooled list it ends up sitting
 * in — otherwise a Store with two separate single-variant Listings reads
 * as "two siblings", keeping the literal "Title" placeholder on screen
 * (issue #56) even though each contributing Listing, on its own, genuinely
 * only had the one variant.
 */
export function normalizeVariantLabel(label: string, siblingCount: number): string {
  if (siblingCount === 1 && label === 'Title') return 'Single';
  return label;
}
