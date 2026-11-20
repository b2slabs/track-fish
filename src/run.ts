import stores from './config/stores.js';
import { writeFile, mkdirSync, existsSync } from 'fs';
import path from 'path';
import zlib from 'zlib';
import { execSync } from 'child_process';
import { computeChecksum } from './lib/checksum.js';
import type { StoreAdapter } from './types/store-adapter.js';
import { ShopifyStoreAdapter } from './adapters/shopify.js';
import { withDataBranchWorktree, commitAndPushDataBranch } from './lib/data-branch.js';
import { processStoreRun } from './process.js';

import { fileURLToPath } from 'url';

const adapterMap: Record<string, StoreAdapter> = {
  shopify: new ShopifyStoreAdapter(),
};

async function main() {
  const today = new Date().toISOString().split('T')[0];
  const releaseTag = `raw-${today}`;
  
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const outDir = path.join(__dirname, '../out');

  if (!existsSync(outDir)) {
    mkdirSync(outDir);
  }

  const manifestData: { filename: string; sha256: string }[] = [];
  const scrapedByStore: { store: typeof stores[number]; data: unknown }[] = [];

  for (const store of stores) {
    console.log(`Scraping ${store.name}...`);
    const adapter = adapterMap[store.platform];
    if (!adapter) {
      throw new Error(`No adapter found for platform: ${store.platform}`);
    }
    const { data, listingCount } = await adapter.scrape(store);
    scrapedByStore.push({ store, data });

    const jsonData = JSON.stringify(data, null, 2);
    const jsonBuffer = Buffer.from(jsonData, 'utf-8');
    const gzippedJsonBuffer = zlib.gzipSync(jsonBuffer);

    const gzipFilename = `${store.slug}.json.gz`;
    const gzipFilePath = path.join(outDir, gzipFilename);

    await new Promise((resolve, reject) => {
      writeFile(gzipFilePath, gzippedJsonBuffer, (err) => {
        if (err) {
          return reject(err);
        }
        resolve(null);
      });
    });

    const checksumHex = computeChecksum(gzippedJsonBuffer);

    console.log(`Scraped ${store.name}: ${listingCount} Listings`);

    manifestData.push({
      filename: gzipFilename,
      sha256: checksumHex
    });
  }

  const manifestPath = path.join(outDir, 'manifest.json');

  await new Promise((resolve, reject) => {
    writeFile(manifestPath, JSON.stringify(manifestData, null, 2), (err) => {
      if (err) {
        return reject(err);
      }
      resolve(null);
    });
  });

  try {
    execSync(`gh release create ${releaseTag} ./out/*.json.gz ./out/manifest.json --repo b2slabs/track-fish --title "Raw archive ${today}" --notes "."`, { stdio: 'inherit' });
  } catch (err) {
    console.error('Release already exists, uploading...');
    execSync(`gh release upload --clobber ${releaseTag} ./out/*.json.gz ./out/manifest.json --repo b2slabs/track-fish`, { stdio: 'inherit' });
  }

  console.log(`Release created/uploaded to ${releaseTag}`);

  await withDataBranchWorktree(async (dataDir) => {
    for (const { store, data } of scrapedByStore) {
      const result = processStoreRun({ store, rawData: data, dataDir });
      if (!result.accepted) {
        console.error(`Rejected ${store.name}: ${result.rejectionReason}`);
        continue;
      }
      console.log(
        `Processed ${store.name}: ${result.listingCount} Listings (${result.changeCount} Change Events, ${result.heartbeatCount} Heartbeats)`
      );
    }

    const committed = commitAndPushDataBranch(dataDir, `Process Scrape Run ${today}`);
    console.log(committed ? 'Pushed updated processed data to data branch.' : 'No processed-data changes to commit.');
  });
}

main().catch(console.error);
