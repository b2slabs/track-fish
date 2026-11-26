import fs from 'fs';
import path from 'path';
import type { CanonicalFishHistory, CanonicalFishHistoryEvent } from '../types/listing.js';

/**
 * One-time migration for issue #96: before `process.ts`'s same-Store merge
 * (issue #56) fell back to `previousListingsByProductId` when diffing a
 * merged Listing (see `process.ts`'s `previous` lookup), a merge group's
 * *composition* changing between runs -- a sibling product newly appearing
 * or dropping out, which changes the compound `listingId` string itself --
 * made `diffListing` treat an already-long-tracked Listing as brand new,
 * writing a second (or third, ...) spurious `'first-observed'` Change
 * Event into its history even though nothing about that Listing was
 * actually new. This compacts each already-published history file in
 * place: for every `listingId` that carries more than one `'first-observed'`
 * event, every one but the chronologically earliest is dropped -- that
 * earliest one is the Listing's real introduction; every later one is a
 * spurious reset the (now-fixed) bug produced.
 *
 * Deliberately does not touch a `listingId`'s other, genuine Change Events
 * (price/available/variants) -- only extra `'first-observed'` entries are
 * ever removed, and only when a given `listingId` has more than one.
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
    const changed = removed > 0;

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
 * Keeps only the chronologically earliest `'first-observed'` event per
 * `listingId`; every later one for that same `listingId` is dropped. Every
 * non-`'first-observed'` event is kept untouched, in its original relative
 * order.
 */
function dropSpuriousFirstObserved(
  events: CanonicalFishHistoryEvent[],
): { events: CanonicalFishHistoryEvent[]; removed: number } {
  const earliestFirstObservedAt = new Map<string, string>();
  for (const event of events) {
    if (!event.changedFields?.includes('first-observed')) continue;
    const current = earliestFirstObservedAt.get(event.listingId);
    if (!current || event.observedAt < current) {
      earliestFirstObservedAt.set(event.listingId, event.observedAt);
    }
  }

  const seenEarliest = new Set<string>();
  const kept: CanonicalFishHistoryEvent[] = [];
  let removed = 0;

  for (const event of events) {
    if (!event.changedFields?.includes('first-observed')) {
      kept.push(event);
      continue;
    }
    const earliest = earliestFirstObservedAt.get(event.listingId);
    const isTheEarliestOne = event.observedAt === earliest && !seenEarliest.has(event.listingId);
    if (isTheEarliestOne) {
      seenEarliest.add(event.listingId);
      kept.push(event);
    } else {
      removed++;
    }
  }

  return { events: kept, removed };
}
