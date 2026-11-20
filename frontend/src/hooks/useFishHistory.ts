import { useEffect, useState } from 'react';
import { fetchFishHistory } from '@/lib/data-source';
import type { CanonicalFishHistory } from '@/types/data';

interface UseFishHistoryResult {
  data: CanonicalFishHistory | null;
  loading: boolean;
  error: string | null;
}

/**
 * Fetches a single Canonical Fish's history file live from the `data`
 * branch, only when a detail view for that fish is opened.
 */
export function useFishHistory(canonicalFishId: string | undefined): UseFishHistoryResult {
  const [data, setData] = useState<CanonicalFishHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canonicalFishId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    fetchFishHistory(canonicalFishId)
      .then((history) => {
        if (!cancelled) setData(history);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load history');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canonicalFishId]);

  return { data, loading, error };
}
