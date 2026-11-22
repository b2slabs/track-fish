import type { ParsedListing, ListingVariant } from '../types/listing.js';
import { stripHtml, decodeHtmlEntities } from './html.js';

interface RawWooCommercePrices {
  price?: string;
  currency_code?: string;
  currency_minor_unit?: number;
}

interface RawWooCommerceImage {
  src?: string;
}

interface RawWooCommerceProduct {
  id: number | string;
  name?: string;
  permalink?: string;
  description?: string;
  short_description?: string;
  prices?: RawWooCommercePrices;
  images?: RawWooCommerceImage[];
  is_in_stock?: boolean;
}

/**
 * Parses a raw archived WooCommerce Store API `/wp-json/wc/store/v1/
 * products` snapshot (as captured by `WooCommerceStoreAdapter.scrape`)
 * into one ParsedListing per product.
 *
 * Unlike Shopify's bulk `/products.json`, which inlines every variant's
 * own price and stock status, the Store API's bulk product list only
 * returns each product's overall price (already the lowest current
 * price across variations, for a variable product -- see `prices.price`)
 * and overall `is_in_stock` -- a per-variation breakdown needs a separate
 * request per product, to `/products/{id}/variations`. Doing that for
 * every variable product (the large majority of the catalog on every
 * WooCommerce Store onboarded so far) would multiply the request count
 * several-fold, well past mirroring Shopify's single bulk-paginated-
 * fetch convention. So each WooCommerce product becomes exactly one
 * synthetic ListingVariant carrying its overall price/availability --
 * still enough to track price and in-stock/out-of-stock changes over
 * time, just without a size/grade breakdown the way a Shopify Listing's
 * variants can have.
 *
 * This is a pure function over already-fetched data -- it does no
 * network I/O and does not know about Canonical Fish identity or
 * observation bookkeeping (see `canonical-fish.ts`).
 */
export function parseWooCommerceListings(
  raw: unknown,
  store: { domain: string; currency?: string }
): ParsedListing[] {
  const products = extractProducts(raw);

  return products.map((product) => {
    const minorUnit = product.prices?.currency_minor_unit ?? 2;
    const price = toDecimal(product.prices?.price, minorUnit);
    const currency = store.currency ?? product.prices?.currency_code ?? 'USD';
    const available = Boolean(product.is_in_stock);
    const imageUrl = product.images?.[0]?.src ?? null;

    const variants: ListingVariant[] = [
      {
        id: String(product.id),
        label: 'Default',
        price,
        available,
      },
    ];

    return {
      productIdentifier: String(product.id),
      commonName: decodeHtmlEntities(product.name ?? ''),
      description: stripHtml(product.description || product.short_description || ''),
      productUrl: product.permalink ?? `https://${store.domain}/`,
      imageUrl,
      currency,
      price,
      available,
      variants,
    } satisfies ParsedListing;
  });
}

function extractProducts(raw: unknown): RawWooCommerceProduct[] {
  if (raw && typeof raw === 'object' && Array.isArray((raw as { products?: unknown }).products)) {
    return (raw as { products: RawWooCommerceProduct[] }).products;
  }
  return [];
}

/** Converts a Store API minor-unit price string (e.g. "999" at
 * currency_minor_unit 2) into a decimal amount (9.99). */
function toDecimal(value: string | undefined, minorUnit: number): number {
  if (!value) {
    return 0;
  }
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return 0;
  }
  return n / Math.pow(10, minorUnit);
}
