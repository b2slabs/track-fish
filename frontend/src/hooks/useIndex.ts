import { useEffect, useState } from 'react';
import { fetchIndex, getCachedIndex } from '@/lib/data-source';
import type { IndexFile } from '@/types/data';

interface UseIndexResult {
  data: IndexFile | null;
  loading: boolean;
  error: string | null;
}

/**
 * Reads the live `index.json` from the `data` branch, fetched and parsed
 * at most once per page session (issue #60) — `fetchIndex()` itself
 * caches the promise/result at module scope, and this hook additionally
 * seeds its state straight from that cache on mount so a second
 * (BrowsePage <-> FishDetailPage) navigation renders the already-loaded
 * data immediately, with no loading-skeleton flash, instead of waiting
 * out another microtask of "loading".
 */
export function useIndex(): UseIndexResult {
  const cached = getCachedIndex();
  const [data, setData] = useState<IndexFile | null>(cached);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (getCachedIndex()) {
      // Already loaded by a previous mount this session — nothing to do.
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchIndex()
      .then((index) => {
        if (!cancelled) setData(index);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load data');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { data, loading, error };
}
