import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { aggregateAndPublish } from '../aggregate.js';

/**
 * CLI used by the aggregation job (see
 * `.github/workflows/daily-pipeline.yml`): reads back every Store's raw
 * archive from `out/` (populated there by downloading all of the scrape
 * matrix job's artifacts beforehand) and does the day's exactly-once
 * Release + `data`-branch commit.
 */
async function main() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const outDir = path.join(__dirname, '../../out');
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }

  await aggregateAndPublish(outDir);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
