import { writeFileSync } from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import stores from './config/stores.js';
import { readScrapedStore } from './scrape.js';
import { buildCombinedRawArchive, combinedGzipFilenameFor } from './lib/raw-archive.js';
import { withDataBranchWorktree, commitAndPushDataBranch } from './lib/data-branch.js';
import { processStoreRun, type StoreConfig } from './process.js';

/**
 * The aggregation step of the daily pipeline (see issue #5 / PRD
 * "Automation", and issue #30 for the combined-archive shape): reads back
 * every Store's raw archive (gzip files already sitting in `outDir`, each
 * written independently by a per-Store scrape -- either in-process via
 * `src/run.ts`, or downloaded as GitHub Actions matrix-job artifacts by
 * `src/cli/aggregate.ts`), then does the two exactly-once side effects for
 * the day: one GitHub Release containing a single combined gzip of every
 * Store's raw data (keyed by store slug) plus its checksum, and one
 * commit+push to the `data` branch of the normalized result. A Store with
 * no archive present in `outDir` (its scrape job failed, or never ran) is
 * skipped rather than blocking the rest.
 */
export async function aggregateAndPublish(outDir: string): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  const releaseTag = `raw-${today}`;

  const scrapedByStore: { store: StoreConfig; data: unknown }[] = [];

  for (const store of stores) {
    const scraped = readScrapedStore(outDir, store);
    if (!scraped) {
      console.error(`No raw archive found for ${store.name} (${store.slug}) -- its scrape step likely failed; skipping.`);
      continue;
    }
    scrapedByStore.push({ store, data: scraped.data });
    console.log(`Found archive for ${store.name}: ${scraped.gzipFilename}`);
  }

  if (scrapedByStore.length === 0) {
    throw new Error('No Store archives were found to aggregate -- every scrape step must have failed.');
  }

  const { gzipBuffer, checksum } = buildCombinedRawArchive(
    scrapedByStore.map(({ store, data }) => ({ slug: store.slug, data }))
  );

  const combinedGzipFilename = combinedGzipFilenameFor(today);
  const combinedGzipPath = path.join(outDir, combinedGzipFilename);
  writeFileSync(combinedGzipPath, gzipBuffer);

  const manifestPath = path.join(outDir, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify({ filename: combinedGzipFilename, sha256: checksum }, null, 2));

  try {
    execSync(
      `gh release create ${releaseTag} ${combinedGzipPath} ${manifestPath} --repo b2slabs/track-fish --title "Raw archive ${today}" --notes "."`,
      { stdio: 'inherit' }
    );
  } catch (err) {
    console.error('Release already exists, uploading...');
    execSync(`gh release upload --clobber ${releaseTag} ${combinedGzipPath} ${manifestPath} --repo b2slabs/track-fish`, {
      stdio: 'inherit',
    });
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
        `Processed ${store.name}: ${result.listingCount} Listings (${result.changeCount} Change Events, ${result.unchangedCount} unchanged, ${result.ambiguousCount} ambiguous matches pending review)`
      );
    }

    const committed = commitAndPushDataBranch(dataDir, `Process Scrape Run ${today}`);
    console.log(committed ? 'Pushed updated processed data to data branch.' : 'No processed-data changes to commit.');
  });
}
