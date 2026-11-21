import { ChevronDown } from 'lucide-react';
import { formatDateTime } from '@/lib/format';
import type { IndexFile } from '@/types/data';

/**
 * Footer-level freshness indicator. Shows a single concise line by
 * default — the index is fetched live, so this is the user's only signal
 * for how fresh the data they're looking at is. The per-store breakdown
 * (name, listing count, last successful run) sits behind a native
 * disclosure so it stays quiet even at the current 14-store scale,
 * instead of dumping a wall of text inline.
 */
export function LastUpdated({ index }: { index: IndexFile }) {
  const stores = Object.values(index.stores);

  return (
    <details className="group text-xs text-muted-foreground">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1 [&::-webkit-details-marker]:hidden hover:text-foreground">
        <span>
          Data last updated{' '}
          <span className="font-medium text-foreground">{formatDateTime(index.generatedAt)}</span>
        </span>
        {stores.length > 0 && (
          <ChevronDown
            className="size-3.5 shrink-0 text-muted-foreground/70 transition-transform duration-150 group-open:rotate-180"
            aria-hidden="true"
          />
        )}
      </summary>
      {stores.length > 0 && (
        <ul className="mt-2 max-w-sm space-y-1 border-t pt-2">
          {stores.map((store) => (
            <li key={store.name} className="flex items-baseline justify-between gap-4">
              <span className="truncate">{store.name}</span>
              <span className="whitespace-nowrap text-muted-foreground/80">
                {store.lastSuccessfulListingCount} listings · {formatDateTime(store.lastSuccessfulRunAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
