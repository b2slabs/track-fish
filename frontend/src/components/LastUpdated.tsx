import { formatDateTime } from '@/lib/format';
import type { IndexFile } from '@/types/data';

/**
 * Surfaces when the processed layer was last regenerated, plus a
 * per-store breakdown — the index is fetched live, so this is the user's
 * only signal for how fresh the data they're looking at is.
 */
export function LastUpdated({ index }: { index: IndexFile }) {
  const stores = Object.values(index.stores);
  return (
    <div className="text-sm text-muted-foreground">
      <p>
        Data last updated <span className="font-medium text-foreground">{formatDateTime(index.generatedAt)}</span>
      </p>
      {stores.length > 0 && (
        <p className="mt-0.5">
          {stores
            .map((store) => `${store.name}: ${store.lastSuccessfulListingCount} listings as of ${formatDateTime(store.lastSuccessfulRunAt)}`)
            .join(' · ')}
        </p>
      )}
    </div>
  );
}
