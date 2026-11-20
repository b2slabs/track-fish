import type { StoreAdapter } from '../types/store-adapter.js';
import zlib from 'zlib';
import { promisify } from 'util';

const sleep = promisify(setTimeout);
const PAGE_SIZE = 250;

export class ShopifyStoreAdapter implements StoreAdapter {
  async scrape(config: { domain: string; slug: string; platform: string; collectionHandle?: string }): Promise<{ data: unknown; listingCount: number }> {
    const { domain, collectionHandle } = config;
    const url = `https://${domain}${collectionHandle ? `/collections/${collectionHandle}/products.json` : '/products.json'}`;
    let allProducts = [];
    let page = 1;

    while (true) {
      const response = await fetch(`${url}?limit=${PAGE_SIZE}&page=${page}`, {
        headers: { 'User-Agent': 'track-fish-scraper/0.1 (+https://github.com/b2slabs/track-fish)' }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch products from ${domain}: ${response.statusText}`);
      }

      const json = await response.json();
      allProducts.push(...json.products);

      if (json.products.length < PAGE_SIZE) {
        break;
      }

      page++;
      await sleep(1000);
    }

    return { data: { products: allProducts }, listingCount: allProducts.length };
  }
}
