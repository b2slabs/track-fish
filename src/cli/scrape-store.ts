import { mkdirSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import stores from '../config/stores.js';
import { scrapeStore } from '../scrape.js';

/**
 * CLI used by the per-Store scrape matrix job (see
 * `.github/workflows/daily-pipeline.yml`): scrapes exactly one configured
 * Store, given its slug, and writes its gzip archive to `out/` for the
 * workflow to upload as an artifact. The aggregation job downloads every
 * Store's artifact and does the actual Release + `data`-branch commit --
 * this script never touches either.
 */
async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error('Usage: tsx src/cli/scrape-store.ts <store-slug>');
    process.exit(1);
  }

  const store = stores.find((s) => s.slug === slug);
  if (!store) {
    console.error(`Unknown store slug: ${slug}. Configured slugs: ${stores.map((s) => s.slug).join(', ')}`);
    process.exit(1);
  }

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const outDir = path.join(__dirname, '../../out');
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }

  const result = await scrapeStore(store, outDir);
  console.log(`Scraped ${store.name}: ${result.listingCount} Listings (sha256 ${result.checksum})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
