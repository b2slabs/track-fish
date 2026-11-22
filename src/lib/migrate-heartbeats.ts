import fs from 'fs';
import path from 'path';
import { isLegacyHistory, migrateLegacyHistory } from './canonical-fish.js';
import type { CanonicalFishHistory, CanonicalFishHistoryEvent } from '../types/listing.js';

/**
 * This migration's own on-disk view of a history file: identical to
 * `CanonicalFishHistory`/`CanonicalFishHistoryEvent` except an event's
 * `type` is widened back to a plain `string` rather than the current,
 * heartbeat-free `'change'` literal — a pre-migration file on disk is
 * exactly the shape this migration exists to handle, and may still
 * genuinely contain `'heartbeat'`.
 */
interface RawHistoryEvent extends Omit<CanonicalFishHistoryEvent, 'type'> {
  type: string;
}
interface RawHistory extends Omit<CanonicalFishHistory, 'events'> {
  events: RawHistoryEvent[];
}

/**
 * One-time migration for issue #81: every history file written before this
 * fix landed can still carry `type: 'heartbeat'` entries from the old
 * "append one event per Listing per day it's observed unchanged" model.
 * This compacts each such file in place:
 *
 *   - For every Listing in `history.listings`, finds that Listing's
 *     chronologically *last* event (any type, heartbeat or change) still
 *     present in `history.events`, and backfills `lastCheckedAt` from its
 *     `observedAt`. This is equivalent to "the latest heartbeat's
 *     timestamp, or the latest change event's timestamp if no heartbeats
 *     exist" (the migration's spec, per issue #81) because events are
 *     always append-only in `observedAt` order — the chronologically last
 *     event for a Listing necessarily already is whichever of those two
 *     applies.
 *   - Strips every `type: 'heartbeat'` entry out of `history.events`.
 *     `type: 'change'` entries are left completely untouched, in both
 *     content and relative order.
 *
 * Pre-#3-shaped ("legacy") files are upgraded to the current shape first
 * (same `migrateLegacyHistory` helper `readHistoryFile` already uses on
 * read) so this single pass also finishes migrating any of those still
 * sitting in the `data` branch, rather than requiring a separate run.
 *
 * Deliberately file-system-level rather than going through
 * `readHistoryFile`/`writeHistoryFile` (which key off a `canonicalFishId`
 * re-derived into a sanitized filename) — operating on the files actually
 * present in `fish/` by their own existing names sidesteps any ambiguity
 * in that derivation and lets this report an exact before/after byte count
 * per file.
 */
export interface FileMigrationResult {
  fileName: string;
  canonicalFishId: string;
  listingCount: number;
  heartbeatsRemoved: number;
  changeEventsUntouched: number;
  bytesBefore: number;
  bytesAfter: number;
  changed: boolean;
}

export interface MigrationSummary {
  filesScanned: number;
  filesChanged: number;
  totalHeartbeatsRemoved: number;
  totalBytesBefore: number;
  totalBytesAfter: number;
  perFile: FileMigrationResult[];
}

const EMPTY_SUMMARY: MigrationSummary = {
  filesScanned: 0,
  filesChanged: 0,
  totalHeartbeatsRemoved: 0,
  totalBytesBefore: 0,
  totalBytesAfter: 0,
  perFile: [],
};

export function migrateHeartbeatsInDataDir(dataDir: string): MigrationSummary {
  const fishDir = path.join(dataDir, 'fish');
  if (!fs.existsSync(fishDir)) {
    return structuredClone(EMPTY_SUMMARY);
  }

  const perFile: FileMigrationResult[] = [];

  for (const fileName of fs.readdirSync(fishDir).filter((f) => f.endsWith('.json')).sort()) {
    const filePath = path.join(fishDir, fileName);
    const beforeText = fs.readFileSync(filePath, 'utf-8');
    const bytesBefore = Buffer.byteLength(beforeText, 'utf-8');

    const raw = JSON.parse(beforeText);
    const history: RawHistory = isLegacyHistory(raw) ? migrateLegacyHistory(raw) : (raw as RawHistory);

    // Chronologically last event per listingId, over EVERY event
    // (heartbeat or change) -- see this module's doc for why that equals
    // the migration spec's "latest heartbeat, else latest change".
    const lastSeenByListing = new Map<string, string>();
    for (const event of history.events) {
      const current = lastSeenByListing.get(event.listingId);
      if (!current || event.observedAt > current) {
        lastSeenByListing.set(event.listingId, event.observedAt);
      }
    }

    const heartbeatEvents = history.events.filter((event) => event.type === 'heartbeat');
    const migratedEvents = history.events.filter((event) => event.type !== 'heartbeat');

    const migratedListings = history.listings.map((listing) => ({
      ...listing,
      // Fallback chain, in priority order:
      //   1. A `lastCheckedAt` this Listing already carries -- meaning this
      //      file was already migrated (or is being kept current by
      //      `processStoreRun` going forward) on a prior pass. Keeping it
      //      as-is, rather than recomputing from this file's own (already
      //      heartbeat-free) events, is what makes re-running this
      //      migration idempotent: once heartbeats are stripped, the
      //      remaining events alone can no longer reconstruct a
      //      heartbeat-driven lastCheckedAt that was *later* than the
      //      latest surviving change event.
      //   2. This listingId's own last event in this file (any type) --
      //      the first-time migration case, where the field has never
      //      existed before.
      //   3. The epoch -- should not happen (every Listing's
      //      first-observed event is always a Change Event, never
      //      stripped), kept only so the field is never left `undefined`
      //      on disk.
      lastCheckedAt: listing.lastCheckedAt ?? lastSeenByListing.get(listing.listingId) ?? new Date(0).toISOString(),
    }));

    // Every surviving event is now guaranteed type: 'change' at runtime
    // (heartbeats were just filtered out above) -- safe to narrow back to
    // the current, heartbeat-free `CanonicalFishHistory` shape.
    const migratedHistory: CanonicalFishHistory = {
      ...history,
      listings: migratedListings,
      events: migratedEvents as unknown as CanonicalFishHistoryEvent[],
    };

    const afterText = JSON.stringify(migratedHistory, null, 2) + '\n';
    const bytesAfter = Buffer.byteLength(afterText, 'utf-8');
    const changed = afterText !== beforeText;

    if (changed) {
      fs.writeFileSync(filePath, afterText);
    }

    perFile.push({
      fileName,
      canonicalFishId: history.canonicalFishId,
      listingCount: history.listings.length,
      heartbeatsRemoved: heartbeatEvents.length,
      changeEventsUntouched: migratedEvents.length,
      bytesBefore,
      bytesAfter,
      changed,
    });
  }

  return {
    filesScanned: perFile.length,
    filesChanged: perFile.filter((f) => f.changed).length,
    totalHeartbeatsRemoved: perFile.reduce((sum, f) => sum + f.heartbeatsRemoved, 0),
    totalBytesBefore: perFile.reduce((sum, f) => sum + f.bytesBefore, 0),
    totalBytesAfter: perFile.reduce((sum, f) => sum + f.bytesAfter, 0),
    perFile,
  };
}
