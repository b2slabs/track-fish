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
 * `siblingCount` is the size of the variant list this label is being
 * rendered inside (e.g. `listing.variants.length`); the placeholder is only
 * ever genuine when that list has exactly one entry — a real multi-variant
 * listing's option values are left untouched even if one happened to also
 * be the literal string "Title".
 */
export function normalizeVariantLabel(label: string, siblingCount: number): string {
  if (siblingCount === 1 && label === 'Title') return 'Single';
  return label;
}
