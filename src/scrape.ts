import { writeFileSync, readFileSync, existsSync } from 'fs';
import path from 'path';
import zlib from 'zlib';
import { computeChecksum } from './lib/checksum.js';
import type { StoreAdapter } from './types/store-adapter.js';
import { ShopifyStoreAdapter } from './adapters/shopify.js';
import type { StoreConfig } from './process.js';

const adapterMap: Record<string, StoreAdapter> = {
  shopify: new ShopifyStoreAdapter(),
};

export interface ScrapeStoreResult {
  store: StoreConfig;
  data: unknown;
  listingCount: number;
  gzipFilename: string;
  checksum: string;
}

function gzipFilenameFor(store: StoreConfig): string {
  return `${store.slug}.json.gz`;
}

/**
 * Scrapes a single Store and writes its gzip-compressed raw archive into
 * `outDir`. This is the unit of work a per-Store GitHub Actions matrix job
 * runs (see `src/cli/scrape-store.ts`); `aggregate.ts` later reads the
 * result back with `readScrapedStore` to build the manifest, Release, and
 * processed-layer commit.
 */
export async function scrapeStore(store: StoreConfig, outDir: string): Promise<ScrapeStoreResult> {
  const adapter = adapterMap[store.platform];
  if (!adapter) {
    throw new Error(`No adapter found for platform: ${store.platform}`);
  }

  const { data, listingCount } = await adapter.scrape(store);

  const jsonBuffer = Buffer.from(JSON.stringify(data, null, 2), 'utf-8');
  const gzippedJsonBuffer = zlib.gzipSync(jsonBuffer);

  const gzipFilename = gzipFilenameFor(store);
  writeFileSync(path.join(outDir, gzipFilename), gzippedJsonBuffer);

  const checksum = computeChecksum(gzippedJsonBuffer);

  return { store, data, listingCount, gzipFilename, checksum };
}

/**
 * Reads back a Store's gzip archive previously written by `scrapeStore`
 * (possibly in a different process/job -- e.g. downloaded as a GitHub
 * Actions artifact into `outDir`). Returns undefined if no archive exists
 * for this Store, which happens when its scrape matrix job failed.
 */
export function readScrapedStore(
  outDir: string,
  store: StoreConfig
): { data: unknown; checksum: string; gzipFilename: string } | undefined {
  const gzipFilename = gzipFilenameFor(store);
  const gzipPath = path.join(outDir, gzipFilename);
  if (!existsSync(gzipPath)) {
    return undefined;
  }

  const gzippedJsonBuffer = readFileSync(gzipPath);
  const checksum = computeChecksum(gzippedJsonBuffer);
  const data = JSON.parse(zlib.gunzipSync(gzippedJsonBuffer).toString('utf-8'));

  return { data, checksum, gzipFilename };
}
