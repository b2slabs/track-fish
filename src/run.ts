import { mkdirSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import stores from './config/stores.js';
import { scrapeStore } from './scrape.js';
import { aggregateAndPublish } from './aggregate.js';

/**
 * Manual, single-process entrypoint (`npm start`): scrapes every configured
 * Store in sequence, then aggregates the results into one Release and one
 * `data`-branch commit. This is the same two phases the GitHub Actions
 * workflow runs split across jobs (see `src/cli/scrape-store.ts` for the
 * per-Store matrix job, `src/cli/aggregate.ts` for the aggregation job) --
 * kept here as a convenient way to run the whole pipeline locally without
 * Actions.
 */
async function main() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const outDir = path.join(__dirname, '../out');

  if (!existsSync(outDir)) {
    mkdirSync(outDir);
  }

  for (const store of stores) {
    console.log(`Scraping ${store.name}...`);
    const result = await scrapeStore(store, outDir);
    console.log(`Scraped ${store.name}: ${result.listingCount} Listings`);
  }

  await aggregateAndPublish(outDir);
}

main().catch(console.error);
