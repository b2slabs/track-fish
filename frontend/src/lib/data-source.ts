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

// Module-level cache (issue #60): `index.json` is ~37MB raw, and
// JSON.parse() of that payload — not the (gzip-compressed, short-TTL
// `cache-control`'d) network transfer — is the actual cost of a "load".
// Without this, every mount of `useIndex` (both BrowsePage and
// FishDetailPage use it) re-fetches AND re-parses the whole file from
// scratch, which is what made browse -> detail -> browse feel
// multi-second-slow even though the underlying data hadn't changed.
// Cached for the lifetime of the page session; a failed fetch clears the
// promise cache so the next call retries rather than wedging the app in
// a permanent error state.
let indexPromise: Promise<IndexFile> | null = null;
let indexCache: IndexFile | null = null;

/** Synchronous peek at the cache, so `useIndex` can skip the loading flash on a cache hit. */
export function getCachedIndex(): IndexFile | null {
  return indexCache;
}

export function fetchIndex(): Promise<IndexFile> {
  if (indexCache) return Promise.resolve(indexCache);
  if (!indexPromise) {
    indexPromise = fetch(liveUrl('index.json'))
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Failed to fetch index.json: ${res.status} ${res.statusText}`);
        }
        return res.json() as Promise<IndexFile>;
      })
      .then((index) => {
        indexCache = index;
        return index;
      })
      .catch((err: unknown) => {
        indexPromise = null;
        throw err;
      });
  }
  return indexPromise;
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
