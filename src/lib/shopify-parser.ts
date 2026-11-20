import type { ParsedListing, ListingVariant } from '../types/listing.js';
import { stripHtml } from './html.js';

interface RawShopifyVariant {
  id: number | string;
  title?: string;
  price?: string | number;
  available?: boolean;
}

interface RawShopifyImage {
  src?: string;
}

interface RawShopifyProduct {
  id: number | string;
  title?: string;
  handle?: string;
  body_html?: string;
  variants?: RawShopifyVariant[];
  images?: RawShopifyImage[];
  options?: { name: string }[];
}

/**
 * Parses a raw archived Shopify `/products.json` snapshot (as captured by
 * `ShopifyStoreAdapter.scrape`) into one ParsedListing per product. Each
 * Shopify "variant" becomes a Listing variant carrying the size/grade label.
 *
 * This is a pure function over already-fetched data — it does no network
 * I/O and does not know about Canonical Fish identity or observation
 * bookkeeping (see `canonical-fish.ts`).
 */
export function parseShopifyListings(
  raw: unknown,
  store: { domain: string; currency?: string }
): ParsedListing[] {
  const products = extractProducts(raw);
  const currency = store.currency ?? 'USD';

  return products.map((product) => {
    const variants = parseVariants(product);
    const inStockVariants = variants.filter((variant) => variant.available);
    const priceSource = inStockVariants.length > 0 ? inStockVariants : variants;
    const price = priceSource.length > 0 ? Math.min(...priceSource.map((v) => v.price)) : 0;
    const available = variants.some((variant) => variant.available);
    const imageUrl = product.images?.[0]?.src ?? null;

    return {
      productIdentifier: String(product.id),
      commonName: product.title ?? '',
      description: stripHtml(product.body_html ?? ''),
      productUrl: `https://${store.domain}/products/${product.handle ?? ''}`,
      imageUrl,
      currency,
      price,
      available,
      variants,
    } satisfies ParsedListing;
  });
}

function extractProducts(raw: unknown): RawShopifyProduct[] {
  if (raw && typeof raw === 'object' && Array.isArray((raw as { products?: unknown }).products)) {
    return (raw as { products: RawShopifyProduct[] }).products;
  }
  return [];
}

function parseVariants(product: RawShopifyProduct): ListingVariant[] {
  const defaultOptionName = product.options?.[0]?.name ?? 'Default';

  return (product.variants ?? []).map((variant) => ({
    id: String(variant.id),
    label: variantLabel(variant, defaultOptionName),
    price: Number(variant.price ?? 0),
    available: Boolean(variant.available),
  }));
}

function variantLabel(variant: RawShopifyVariant, defaultOptionName: string): string {
  if (variant.title && variant.title !== 'Default Title') {
    return variant.title;
  }
  return defaultOptionName;
}
