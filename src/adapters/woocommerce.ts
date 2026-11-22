import type { StoreAdapter } from '../types/store-adapter.js';
import { promisify } from 'util';

const sleep = promisify(setTimeout);
// The WooCommerce Store API (`/wp-json/wc/store/v1/products`) caps
// `per_page` at 100 -- unlike Shopify's 250 -- so this is the largest
// page size that works across stores.
const PAGE_SIZE = 100;
// Observed in practice against aqua-imports.com (a WP Engine-hosted
// Store): an occasional transient Gateway Timeout / connection reset on
// an otherwise-healthy endpoint, not a persistent block -- immediately
// retrying the same page succeeds. A handful of retries with a short
// backoff absorbs that without masking a genuine, persistent failure
// (which still throws after exhausting them, same as Shopify's adapter
// throwing on a non-ok response).
const MAX_ATTEMPTS_PER_PAGE = 3;

/**
 * Scrapes a WooCommerce Store's public Store API (issue #80): the
 * first (and, so far, only) non-Shopify platform this project onboards.
 * Mirrors ShopifyStoreAdapter's conventions -- custom User-Agent, ~1
 * req/sec between pages, public endpoint only, full pagination via the
 * `X-WP-TotalPages` response header -- but needs one thing Shopify's
 * `/products.json` never required: a same-origin `Referer` header.
 *
 * At least one onboarded Store (wetspottropicalfish.com) runs a
 * Cloudflare WAF rule that 403s *every* request to the `wc/store/v1`
 * namespace -- including a real browser's own `/cart` AJAX calls --
 * unless the request carries a `Referer` pointing back at the Store's
 * own domain. That's not a bot-detection/JS challenge this scraper is
 * bypassing (no cookies or challenge token are involved, and it holds up
 * across User-Agents); it is simply part of what "the public endpoint"
 * requires here, the same way a page number is. Sending it is harmless
 * on Stores that don't need it (aqua-imports.com never 403s regardless).
 */
export class WooCommerceStoreAdapter implements StoreAdapter {
  async scrape(config: { domain: string; slug: string; platform: string; collectionHandle?: string }): Promise<{ data: unknown; listingCount: number }> {
    const { domain } = config;
    const url = `https://${domain}/wp-json/wc/store/v1/products`;
    const allProducts: unknown[] = [];
    let page = 1;

    while (true) {
      const products = await this.fetchPage(url, domain, page);
      allProducts.push(...products);

      if (products.length < PAGE_SIZE) {
        break;
      }

      page++;
      await sleep(1000);
    }

    return { data: { products: allProducts }, listingCount: allProducts.length };
  }

  private async fetchPage(url: string, domain: string, page: number): Promise<unknown[]> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_PAGE; attempt++) {
      try {
        const response = await fetch(`${url}?per_page=${PAGE_SIZE}&page=${page}`, {
          headers: {
            'User-Agent': 'track-fish-scraper/0.1 (+https://github.com/b2slabs/track-fish)',
            Referer: `https://${domain}/`,
          },
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch products from ${domain}: ${response.statusText}`);
        }

        return await response.json();
      } catch (err) {
        lastError = err;
        if (attempt < MAX_ATTEMPTS_PER_PAGE) {
          await sleep(1000 * attempt);
        }
      }
    }

    throw lastError;
  }
}
