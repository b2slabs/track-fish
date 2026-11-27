import fs from 'fs';
import path from 'path';
import type { CanonicalFishHistory, CanonicalFishHistoryEvent } from '../types/listing.js';
import { readHistoryFile, writeHistoryFile } from './data-branch.js';

/**
 * One-time migration for issue #122. Context: a sequence of `data`-branch
 * migration mistakes required reverting the whole branch back to commit
 * `eb7ff7ec3` ("Process Scrape Run 2026-11-25"), which wiped out commit
 * `87f47e8640` ("Process Scrape Run 2026-11-26")'s real, genuine Change
 * Events. Some of those lost transitions were independently rediscovered
 * by later scrape runs and re-recorded under the *wrong* (later) date,
 * with no `confirmedSameUntil` (issue #113 didn't exist in the codebase
 * yet when that re-scrape ran) -- exactly the Monster Aquarium /
 * `cf-sci-corydoras-habrosus.json` case already hand-fixed as a one-off
 * (see `data` branch commit "Restore true Nov 26 out-of-stock date...").
 * This module generalizes that fix to every other affected Listing.
 *
 * Two phases, deliberately kept as separate pure functions so each can be
 * unit-tested (and dry-run-reported) independently of git/filesystem
 * orchestration, which lives in `src/cli/restore-lost-nov26-changes.ts`:
 *
 *   1. `findLostNov26Events` -- diffs two directories (checkouts of
 *      `eb7ff7ec3` and `87f47e8640`) and returns every event present in
 *      the latter but not the former, globally by `listingId` (not
 *      per-filename -- a Listing's file can differ between then and now,
 *      e.g. issue #114's genus-synonym merges already renamed some).
 *   2. `restoreLostNov26EventsInDataDir` -- applies each lost event to the
 *      CURRENT (live `data` branch tip) directory: fixes a late
 *      rediscovery in place (date + `confirmedSameUntil`, mirroring
 *      `process.ts`'s own `confirmedSameUntil` logic exactly), restores a
 *      never-rediscovered event at its correct historical position in its
 *      Listing's CURRENT canonical-fish file, or reports the Listing as
 *      unresolved if no current file carries it at all (same edge case
 *      issue #114's agent hit).
 */

/** The minimal event shape identity/state comparisons need. */
type ComparableEvent = Pick<CanonicalFishHistoryEvent, 'listingId' | 'observedAt' | 'price' | 'available' | 'variants'>;

function identityKey(event: ComparableEvent): string {
  return [event.listingId, event.observedAt, event.price, event.available, JSON.stringify(event.variants)].join('|');
}

/** State only (ignores observedAt, changedFields, confirmedSameUntil) --
 * used to recognize a late rediscovery of the same resulting state under
 * a different (wrong) date. */
function stateKey(event: Pick<CanonicalFishHistoryEvent, 'price' | 'available' | 'variants'>): string {
  return JSON.stringify({ price: event.price, available: event.available, variants: event.variants });
}

/** Reads every fish history file in `dataDir`, tolerant of a missing
 * `fish/` directory (returns an empty list). */
function readAllHistories(dataDir: string): CanonicalFishHistory[] {
  const fishDir = path.join(dataDir, 'fish');
  if (!fs.existsSync(fishDir)) {
    return [];
  }
  const fileNames = fs.readdirSync(fishDir).filter((f) => f.endsWith('.json'));
  const histories: CanonicalFishHistory[] = [];
  for (const fileName of fileNames) {
    const raw = JSON.parse(fs.readFileSync(path.join(fishDir, fileName), 'utf-8')) as { canonicalFishId: string };
    const history = readHistoryFile(dataDir, raw.canonicalFishId);
    if (history) {
      histories.push(history);
    }
  }
  return histories;
}

function flattenEvents(histories: CanonicalFishHistory[]): CanonicalFishHistoryEvent[] {
  return histories.flatMap((h) => h.events);
}

/** One Change Event genuinely added by commit `87f47e8640` ("Process
 * Scrape Run 2026-11-26") that is absent from `eb7ff7ec3` ("Process Scrape
 * Run 2026-11-25", the pre-revert baseline). */
export interface LostEvent {
  listingId: string;
  event: CanonicalFishHistoryEvent;
}

/**
 * Diffs `baselineDir` (a checkout of `eb7ff7ec3`) against `nov26Dir` (a
 * checkout of `87f47e8640`) and returns every event present in the latter
 * but not the former, by `(listingId, observedAt, price, available,
 * variants)` identity -- ignoring `changedFields`/`confirmedSameUntil`,
 * which can legitimately differ without the event itself being new.
 */
export function findLostNov26Events(baselineDir: string, nov26Dir: string): LostEvent[] {
  const baselineKeys = new Set(flattenEvents(readAllHistories(baselineDir)).map(identityKey));
  const nov26Events = flattenEvents(readAllHistories(nov26Dir));
  return nov26Events
    .filter((event) => !baselineKeys.has(identityKey(event)))
    .map((event) => ({ listingId: event.listingId, event }));
}

/**
 * Builds a `listingId` -> `lastCheckedAt` index over every Listing in
 * `dataDir` (intended for the `eb7ff7ec3` baseline checkout) -- the value
 * `process.ts`'s own `confirmedSameUntil` logic stamps when it was about
 * to be overwritten by a later run's observation.
 */
export function buildLastCheckedAtIndex(dataDir: string): Map<string, string> {
  const index = new Map<string, string>();
  for (const history of readAllHistories(dataDir)) {
    for (const listing of history.listings) {
      index.set(listing.listingId, listing.lastCheckedAt);
    }
  }
  return index;
}

export type RestoreActionKind = 'fixed-in-place' | 'restored' | 'unresolved' | 'already-present';

export interface RestoreAction {
  listingId: string;
  kind: RestoreActionKind;
  /** The lost event's true `observedAt`, from `87f47e8640`. */
  trueObservedAt: string;
  /** The Listing's CURRENT canonical-fish id, when resolved. */
  canonicalFishId?: string;
  /** For `fixed-in-place`: the wrong date the rediscovered event carried
   * before this fix. */
  wrongObservedAt?: string;
  /** For `fixed-in-place`: the `confirmedSameUntil` stamped, if any. */
  confirmedSameUntil?: string;
}

/**
 * Applies every lost Nov 26 event to `currentDir` (the live `data` branch
 * tip, or a scratch copy of it for a dry run) and returns one
 * `RestoreAction` per lost event describing what happened. Mutates
 * `currentDir`'s fish history files in place; `index.json` is
 * deliberately untouched (per issue #122, nothing about a Listing's
 * current identity/grouping changes here -- only its event history).
 */
export function restoreLostNov26EventsInDataDir(
  currentDir: string,
  lostEvents: LostEvent[],
  baselineLastCheckedAt: Map<string, string>
): RestoreAction[] {
  // listingId -> canonicalFishId, from whichever current history file's
  // `listings` array actually carries it -- NOT necessarily the same
  // filename the Listing lived under in either old commit (issue #114's
  // genus-synonym merges already moved some Listings between files).
  const canonicalFishIdByListing = new Map<string, string>();
  for (const history of readAllHistories(currentDir)) {
    for (const listing of history.listings) {
      canonicalFishIdByListing.set(listing.listingId, history.canonicalFishId);
    }
  }

  const actions: RestoreAction[] = [];

  for (const lost of lostEvents) {
    const canonicalFishId = canonicalFishIdByListing.get(lost.listingId);
    if (!canonicalFishId) {
      actions.push({ listingId: lost.listingId, kind: 'unresolved', trueObservedAt: lost.event.observedAt });
      continue;
    }

    const history = readHistoryFile(currentDir, canonicalFishId)!;
    const lostStateKey = stateKey(lost.event);
    const listingEvents = history.events
      .filter((e) => e.listingId === lost.listingId)
      .sort((a, b) => a.observedAt.localeCompare(b.observedAt));

    // Idempotency / false-positive guard: an event with this EXACT
    // identity can already be sitting in the current history, for two
    // reasons -- (1) this exact fix was already hand-applied (e.g. the
    // Monster Aquarium precedent, already pushed before this migration
    // ran), or (2) `findLostNov26Events`'s listingId-based identity key
    // can false-positive when a Listing's compound listingId itself
    // changed between the baseline and Nov26 commits for an UNRELATED
    // reason -- most commonly a same-Store merge group growing a new
    // member (see `mergedListingId`'s own documented limitation in
    // canonical-fish.ts): that reshuffles every one of the Listing's
    // OLDER, genuinely-unaffected events onto a new listingId string,
    // which then fails the identity-key match against the baseline's old
    // listingId even though nothing about that older event actually
    // changed. Either way, if the exact event is already present under
    // this exact listingId in the CURRENT data, there is nothing to do --
    // inserting it again would create a duplicate.
    const alreadyPresent = listingEvents.some(
      (e) => e.observedAt === lost.event.observedAt && stateKey(e) === lostStateKey
    );
    if (alreadyPresent) {
      actions.push({ listingId: lost.listingId, kind: 'already-present', canonicalFishId, trueObservedAt: lost.event.observedAt });
      continue;
    }

    const rediscovery = listingEvents.find(
      (e) => e.observedAt > lost.event.observedAt && !e.confirmedSameUntil && stateKey(e) === lostStateKey
    );

    if (rediscovery) {
      // Fix in place: correct the date, and mirror process.ts's own
      // confirmedSameUntil logic exactly -- only stamp it when the
      // baseline's lastCheckedAt is later than the PREVIOUS real event's
      // own date for this Listing (i.e. there really was at least one
      // confirmed-unchanged day between them).
      const previousEventObservedAt = listingEvents
        .filter((e) => e !== rediscovery && e.observedAt < lost.event.observedAt)
        .at(-1)?.observedAt;
      const oldLastCheckedAt = baselineLastCheckedAt.get(lost.listingId);

      const updated: CanonicalFishHistoryEvent = { ...rediscovery, observedAt: lost.event.observedAt };
      if (oldLastCheckedAt && previousEventObservedAt && oldLastCheckedAt > previousEventObservedAt) {
        updated.confirmedSameUntil = oldLastCheckedAt;
      }

      const newEvents = history.events
        .map((e) => (e === rediscovery ? updated : e))
        .sort((a, b) => a.observedAt.localeCompare(b.observedAt));
      writeHistoryFile(currentDir, { ...history, events: newEvents });

      actions.push({
        listingId: lost.listingId,
        kind: 'fixed-in-place',
        canonicalFishId,
        trueObservedAt: lost.event.observedAt,
        wrongObservedAt: rediscovery.observedAt,
        confirmedSameUntil: updated.confirmedSameUntil,
      });
    } else {
      // Never rediscovered: restore the lost event itself, untouched, at
      // its correct chronological position.
      const newEvents = [...history.events, lost.event].sort((a, b) => a.observedAt.localeCompare(b.observedAt));
      writeHistoryFile(currentDir, { ...history, events: newEvents });

      actions.push({
        listingId: lost.listingId,
        kind: 'restored',
        canonicalFishId,
        trueObservedAt: lost.event.observedAt,
      });
    }
  }

  return actions;
}
