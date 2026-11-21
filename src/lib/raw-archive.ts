import zlib from 'zlib';
import { computeChecksum } from './checksum.js';

export interface CombinedRawArchive {
  /** Every Store's raw scraped data, keyed by store slug. */
  combined: Record<string, unknown>;
  /** Gzip-compressed JSON of `combined` -- the day's single Release asset. */
  gzipBuffer: Buffer;
  /** SHA-256 of `gzipBuffer`, for the manifest/checksum uploaded alongside it. */
  checksum: string;
}

/**
 * Combines every Store's raw scraped data into a single JSON structure
 * keyed by store slug, then gzip-compresses it (see issue #30 / ADR 0001).
 * This replaces producing one gzip per Store: the raw archive's Release
 * now carries exactly one combined gzip asset per day, covering every
 * configured Store, instead of N per-Store assets.
 */
export function buildCombinedRawArchive(entries: { slug: string; data: unknown }[]): CombinedRawArchive {
  const combined: Record<string, unknown> = {};
  for (const { slug, data } of entries) {
    combined[slug] = data;
  }

  const jsonBuffer = Buffer.from(JSON.stringify(combined, null, 2), 'utf-8');
  const gzipBuffer = zlib.gzipSync(jsonBuffer);
  const checksum = computeChecksum(gzipBuffer);

  return { combined, gzipBuffer, checksum };
}

/** Filename for the combined raw archive asset of a given day (`YYYY-MM-DD`). */
export function combinedGzipFilenameFor(dateStr: string): string {
  return `raw-${dateStr}.json.gz`;
}
