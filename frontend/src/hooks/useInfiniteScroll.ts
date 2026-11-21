import { useEffect, useRef, useState } from 'react';

/**
 * How long to keep the lightweight loading indicator visible after a batch
 * is revealed. The data is already in memory (client-side slicing), so this
 * is purely a UX signal for the brief render/layout moment, not a network
 * wait.
 */
const LOADING_INDICATOR_MS = 150;

interface UseInfiniteScrollOptions {
  /** Whether there is more content left to reveal. */
  hasMore: boolean;
  /** Called at most once per intersection to reveal the next batch. */
  onLoadMore: () => void;
  /** How far before the sentinel enters the viewport to trigger a load. */
  rootMargin?: string;
}

interface UseInfiniteScrollResult {
  /** Attach to a sentinel element placed near the end of the list. */
  sentinelRef: React.RefObject<HTMLDivElement | null>;
  /** True for a brief moment after a batch is revealed. */
  isLoadingMore: boolean;
}

/**
 * Observes a sentinel element with IntersectionObserver and calls
 * `onLoadMore` once per intersection while `hasMore` is true.
 *
 * Guards against duplicate/skip bugs that commonly plague infinite scroll:
 * - A `pendingRef` lock blocks re-entrant triggers (e.g. the observer firing
 *   again before the resulting re-render/observer-reset has settled), so
 *   fast or repeated scrolling can't fire two loads for the same approach
 *   to the sentinel.
 * - The observer is torn down and recreated whenever `hasMore` or
 *   `onLoadMore` changes (i.e. whenever the caller's visible count moves),
 *   so a sentinel that is still on-screen after a batch loads will
 *   correctly trigger another load rather than going silent, and a
 *   sentinel that's no longer the bottom of the list stops being watched.
 */
export function useInfiniteScroll({
  hasMore,
  onLoadMore,
  rootMargin = '600px',
}: UseInfiniteScrollOptions): UseInfiniteScrollResult {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const pendingRef = useRef(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        if (pendingRef.current) return;
        pendingRef.current = true;
        setIsLoadingMore(true);
        onLoadMore();
        window.setTimeout(() => {
          pendingRef.current = false;
          setIsLoadingMore(false);
        }, LOADING_INDICATOR_MS);
      },
      { rootMargin },
    );

    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [hasMore, onLoadMore, rootMargin]);

  // If the list shrinks (e.g. a filter change) past the point where more
  // can be loaded, make sure we don't leave a stale loading flag behind.
  useEffect(() => {
    if (!hasMore) {
      pendingRef.current = false;
      setIsLoadingMore(false);
    }
  }, [hasMore]);

  return { sentinelRef, isLoadingMore };
}
