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
 *
 * issue #37: a bare IntersectionObserver isn't enough. Some browsers
 * (most notably WebKit/Safari) don't reliably re-run the observer's
 * callback during sustained, one-directional momentum/inertial scrolling —
 * the browser's own intersection bookkeeping can lag behind the actual
 * geometry until something else (a direction change, a scroll-end, a
 * resize) forces a recompute. In practice that's exactly the reported bug:
 * scrolling down smoothly from the top never loads more, but scrolling up
 * and back down "unsticks" it. Chromium's observer was verified (via
 * instrumented logging across paced/rapid wheel scroll, synthesized
 * momentum-fling gestures, throttled CPU/network, and multiple viewport
 * sizes) to recompute correctly on every continuous downward scroll, so
 * this is a browser-timing gap rather than a bug in the lock or in how
 * `hasMore` is computed upstream. Fix: back the observer with a throttled
 * native `scroll` listener that manually re-checks the sentinel's position
 * against the same lookahead margin and funnels through the identical
 * `pendingRef`-guarded path, so a load is never solely dependent on the
 * browser successfully delivering an IntersectionObserver callback
 * mid-scroll.
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

    const tryLoad = (isNear: boolean) => {
      if (!isNear) return;
      if (pendingRef.current) return;
      pendingRef.current = true;
      setIsLoadingMore(true);
      onLoadMore();
      window.setTimeout(() => {
        pendingRef.current = false;
        setIsLoadingMore(false);
      }, LOADING_INDICATOR_MS);
    };

    const observer = new IntersectionObserver(
      (entries) => tryLoad(entries[0]?.isIntersecting ?? false),
      { rootMargin },
    );
    observer.observe(el);

    // Fallback: manually re-check the sentinel's position on scroll,
    // rAF-throttled so it costs at most one layout read per frame. This is
    // deliberately the same lookahead distance as `rootMargin` and the same
    // `tryLoad` gate, so it can only ever reach the same outcome the
    // observer would — it just doesn't depend on the observer's callback
    // actually firing.
    const margin = parseFloat(rootMargin) || 0;
    let rafId: number | null = null;
    const checkManually = () => {
      rafId = null;
      const rect = el.getBoundingClientRect();
      tryLoad(rect.top <= window.innerHeight + margin);
    };
    const onScroll = () => {
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(checkManually);
    };
    window.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', onScroll);
      if (rafId !== null) window.cancelAnimationFrame(rafId);
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
