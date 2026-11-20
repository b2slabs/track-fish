import { useEffect, useState } from 'react';
import { fetchIndex } from '@/lib/data-source';
import type { IndexFile } from '@/types/data';

interface UseIndexResult {
  data: IndexFile | null;
  loading: boolean;
  error: string | null;
}

/** Fetches the live `index.json` from the `data` branch once on mount. */
export function useIndex(): UseIndexResult {
  const [data, setData] = useState<IndexFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
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
