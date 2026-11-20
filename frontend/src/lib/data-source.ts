import type { CanonicalFishHistory, IndexFile } from '@/types/data';

/**
 * The processed layer lives on a dedicated `data` branch (see
 * docs/adr/0003-processed-data-as-static-json-fetched-live.md) and is
 * fetched live, at runtime, directly from raw.githubusercontent.com. The
 * site itself is never rebuilt in response to a scrape run.
 */
const DATA_BRANCH_RAW_BASE =
  'https://raw.githubusercontent.com/b2slabs/track-fish/data';

/** Cache-bust the CDN in front of raw.githubusercontent.com (~5 min TTL). */
function liveUrl(path: string): string {
  return `${DATA_BRANCH_RAW_BASE}/${path}?t=${Date.now()}`;
}

/**
 * Mirrors `historyFilePath` in `src/lib/data-branch.ts` on `main`: every
 * character outside [a-zA-Z0-9_-] is replaced with '-' to produce a safe
 * filename, e.g. "cf:aquatic-arts:123" -> "cf-aquatic-arts-123.json".
 */
export function canonicalFishIdToFilename(canonicalFishId: string): string {
  return canonicalFishId.replace(/[^a-zA-Z0-9_-]/g, '-');
}

export async function fetchIndex(): Promise<IndexFile> {
  const res = await fetch(liveUrl('index.json'));
  if (!res.ok) {
    throw new Error(`Failed to fetch index.json: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as IndexFile;
}

export async function fetchFishHistory(
  canonicalFishId: string,
): Promise<CanonicalFishHistory> {
  const filename = canonicalFishIdToFilename(canonicalFishId);
  const res = await fetch(liveUrl(`fish/${filename}.json`));
  if (!res.ok) {
    throw new Error(
      `Failed to fetch history for ${canonicalFishId}: ${res.status} ${res.statusText}`,
    );
  }
  return (await res.json()) as CanonicalFishHistory;
}
