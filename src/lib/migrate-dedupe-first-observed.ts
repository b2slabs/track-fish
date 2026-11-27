import fs from 'fs';
import path from 'path';
import type { CanonicalFishHistory, CanonicalFishHistoryEvent } from '../types/listing.js';
import { variantsDiffer } from './diff.js';

/**
 * One-time migration for issue #96: before `process.ts`'s same-Store merge
 * (issue #56) fell back to `previousListingsByProductId` when diffing a
 * merged Listing (see `process.ts`'s `previous` lookup), a merge group's
 * *composition* changing between runs -- a sibling product newly appearing
 * or dropping out, which changes the compound `listingId` string itself --
 * made `diffListing` treat an already-long-tracked Listing as brand new,
 * writing a second (or third, ...) spurious `'first-observed'` Change
 * Event into its history even though nothing about that Listing was
 * actually new.
 *
 * Corrected after a real-data regression (user-reported, see issue #96's
 * follow-up): the first version of this migration dropped EVERY
 * non-earliest `'first-observed'` event per `listingId` unconditionally,
 * assuming each one was pure noise. That destroyed real information for
 * any duplicate that happened to also carry a genuine price/availability/
 * variant change (e.g. a Listing restocking) -- the bug mislabels the
 * *reason* for a Change Event, not its *values*, so a "duplicate
 * first-observed" can still be the only record of a real state change.
 *
 * This version instead replays each `listingId`'s events in chronological
 * order and, for every `'first-observed'` event beyond the true first one,
 * compares it against the most recently *kept* event for that `listingId`
 * (mirroring `diffListing`'s own price/available/variants comparison):
 *   - no real difference -> genuinely spurious, dropped.
 *   - a real difference -> kept, with `changedFields` corrected to what
 *     actually changed, instead of the mislabeled `'first-observed'`.
 *
 * Every non-`'first-observed'` event is always kept untouched -- only
 * `'first-observed'` entries beyond a `listingId`'s true first are ever
 * reconsidered.
 */
export interface FileDedupeResult {
  fileName: string;
  canonicalFishId: string;
  spuriousEventsRemoved: number;
  changed: boolean;
}

export interface DedupeSummary {
  filesScanned: number;
  filesChanged: number;
  totalSpuriousEventsRemoved: number;
  perFile: FileDedupeResult[];
}

export function dedupeSpuriousFirstObservedInDataDir(dataDir: string): DedupeSummary {
  const fishDir = path.join(dataDir, 'fish');
  if (!fs.existsSync(fishDir)) {
    return { filesScanned: 0, filesChanged: 0, totalSpuriousEventsRemoved: 0, perFile: [] };
  }

  const perFile: FileDedupeResult[] = [];

  for (const fileName of fs.readdirSync(fishDir).filter((f) => f.endsWith('.json')).sort()) {
    const filePath = path.join(fishDir, fileName);
    const beforeText = fs.readFileSync(filePath, 'utf-8');
    const history: CanonicalFishHistory = JSON.parse(beforeText);

    const { events, removed } = dropSpuriousFirstObserved(history.events);

    const afterHistory: CanonicalFishHistory = { ...history, events };
    const afterText = JSON.stringify(afterHistory, null, 2) + '\n';
    // Compare serialized text, not just `removed > 0` -- a relabeled event
    // (changedFields corrected, nothing removed) changes the file on disk
    // too, and must be written, not silently skipped.
    const changed = afterText !== beforeText;

    if (changed) {
      fs.writeFileSync(filePath, afterText);
    }

    perFile.push({
      fileName,
      canonicalFishId: history.canonicalFishId,
      spuriousEventsRemoved: removed,
      changed,
    });
  }

  return {
    filesScanned: perFile.length,
    filesChanged: perFile.filter((f) => f.changed).length,
    totalSpuriousEventsRemoved: perFile.reduce((sum, f) => sum + f.spuriousEventsRemoved, 0),
    perFile,
  };
}

/**
 * Replays each `listingId`'s events in their original chronological order
 * (the array's own order -- callers already sort by `observedAt` before
 * writing a history file). The first event seen for a `listingId` is
 * always its true anchor, kept as-is regardless of its own `changedFields`.
 * Every later `'first-observed'` event for that same `listingId` is
 * compared against the most recently kept event's price/available/variants
 * (see this module's own doc): identical -> dropped as genuinely spurious;
 * different -> kept, `changedFields` corrected to the real diff. A
 * non-`'first-observed'` event is always kept, and becomes the new
 * "most recently kept" state to compare the next duplicate against.
 */
function dropSpuriousFirstObserved(
  events: CanonicalFishHistoryEvent[],
): { events: CanonicalFishHistoryEvent[]; removed: number } {
  const lastKeptByListingId = new Map<string, CanonicalFishHistoryEvent>();
  const kept: CanonicalFishHistoryEvent[] = [];
  let removed = 0;

  for (const event of events) {
    const lastKept = lastKeptByListingId.get(event.listingId);
    const isDuplicateFirstObserved = lastKept !== undefined && event.changedFields?.includes('first-observed');

    if (!isDuplicateFirstObserved) {
      kept.push(event);
      lastKeptByListingId.set(event.listingId, event);
      continue;
    }

    const changedFields: string[] = [];
    if (lastKept.price !== event.price) changedFields.push('price');
    if (lastKept.available !== event.available) changedFields.push('available');
    if (variantsDiffer(lastKept.variants, event.variants)) changedFields.push('variants');

    if (changedFields.length === 0) {
      removed++;
      continue;
    }

    const relabeled: CanonicalFishHistoryEvent = { ...event, changedFields };
    kept.push(relabeled);
    lastKeptByListingId.set(event.listingId, relabeled);
  }

  return { events: kept, removed };
}
