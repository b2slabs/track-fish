import fs from 'fs';
import path from 'path';
import type { CanonicalFishHistory } from '../types/listing.js';
import { GENUS_SYNONYMS } from './scientific-name.js';
import { readHistoryFile, writeHistoryFile, deleteHistoryFile, readIndexFile, writeIndexFile } from './data-branch.js';
import { removeListingFromHistory, mergeListingIntoHistory } from './canonical-fish.js';

/**
 * One-time migration for issue #114. Context: issue #90 added
 * `GENUS_SYNONYMS` (`scientific-name.ts`) so a *newly-matched* Listing
 * under a reclassified genus (e.g. Hoplisoma/Gastrodermus, folded back
 * into Corydoras) converges on the same `cf:sci:<slug>` id as its
 * Corydoras-genus counterpart. That fix is forward-only: it does not
 * retroactively recompute the `canonicalFishId` of a Listing already
 * filed under the old genus's slug before the fix shipped, so e.g.
 * `cf:sci:gastrodermus-hastatus` and `cf:sci:corydoras-hastatus` stayed
 * two permanently separate Canonical Fish entries for the same species
 * (issue #16's original report, reopened by issue #114).
 *
 * This migration finds every published fish history file whose
 * `canonicalFishId` is still keyed on a synonym genus and:
 *   - merges it into its canonical counterpart's history file, if one
 *     already exists (the common case -- another Store's Listing of the
 *     same species already extracted the canonical genus name), using
 *     the same `removeListingFromHistory`/`mergeListingIntoHistory`
 *     remove-and-merge pair `process.ts`'s same-Store merge and
 *     cross-run repoint logic already use for "move this Listing's
 *     history from one Canonical Fish id to another" -- applied here
 *     per-Listing across every Listing the old file carries, so nothing
 *     requires the two files to have disjoint Listings (they always do
 *     in practice, since Listings are deduplicated by listingId).
 *   - otherwise renames/re-keys it in place -- there is no canonical
 *     file to merge into yet, so the old file's own Listings/events
 *     become the first (and only) contents of the new canonical id. This
 *     falls out of the same per-Listing merge loop: merging into a
 *     nonexistent target is exactly a rename.
 *
 * `index.json`'s `listings` array is updated in the same pass so every
 * migrated Listing's own `canonicalFishId` field agrees with where its
 * history actually now lives -- otherwise the frontend's grouping (which
 * reads `index.json` directly, not the fish history files) would
 * disagree with the merged history on disk.
 *
 * Idempotent: a second run finds every file already canonicalized (the
 * genus token is no longer a registered synonym once rewritten), so
 * `canonicalizeGenusSynonymFishId` is the identity on every remaining id
 * and nothing is touched.
 */

export interface GenusSynonymFileResult {
  oldFileName: string;
  oldCanonicalFishId: string;
  newCanonicalFishId: string;
  /** True if an existing canonical file absorbed this one; false if this
   * file was the only one under its synonym genus and was renamed/re-keyed
   * instead. */
  mergedIntoExisting: boolean;
  listingsMoved: number;
  eventsMoved: number;
}

export interface GenusSynonymMergeSummary {
  filesScanned: number;
  filesAffected: number;
  listingsUpdatedInIndex: number;
  perFile: GenusSynonymFileResult[];
}

/**
 * Rewrites a `cf:sci:<slug>[:<variety>]` id's genus token through
 * `GENUS_SYNONYMS`, leaving everything else (species word(s), variety
 * suffix) untouched. Non-`cf:sci:` ids, and `cf:sci:` ids whose genus has
 * no registered synonym, are returned unchanged -- callers use identity
 * (`result === input`) to detect "nothing to migrate".
 */
export function canonicalizeGenusSynonymFishId(fishId: string): string {
  const prefix = 'cf:sci:';
  if (!fishId.startsWith(prefix)) {
    return fishId;
  }
  const rest = fishId.slice(prefix.length);
  const [slugPart, ...varietyParts] = rest.split(':');
  const [genusSlug, ...speciesSlugParts] = slugPart.split('-');
  const canonicalGenus = GENUS_SYNONYMS[genusSlug];
  if (!canonicalGenus) {
    return fishId;
  }
  const newSlugPart = [canonicalGenus, ...speciesSlugParts].join('-');
  return [prefix + newSlugPart, ...varietyParts].join(':');
}

/**
 * Runs the migration against `dataDir` (a `data`-branch worktree, or any
 * directory with the same `fish/<id>.json` + `index.json` layout). Mutates
 * files on disk in place -- callers that want a dry run should point this
 * at a scratch copy of the directory, not the real worktree, and inspect
 * the returned summary before deciding to commit/push anything.
 */
export function mergeGenusSynonymFishInDataDir(dataDir: string): GenusSynonymMergeSummary {
  const fishDir = path.join(dataDir, 'fish');
  if (!fs.existsSync(fishDir)) {
    return { filesScanned: 0, filesAffected: 0, listingsUpdatedInIndex: 0, perFile: [] };
  }

  const fileNames = fs.readdirSync(fishDir).filter((f) => f.endsWith('.json')).sort();
  const perFile: GenusSynonymFileResult[] = [];

  for (const fileName of fileNames) {
    const filePath = path.join(fishDir, fileName);
    if (!fs.existsSync(filePath)) {
      // Already consumed as the merge target of an earlier file in this
      // same loop iteration shouldn't be possible (targets are read fresh
      // via readHistoryFile, not deleted), but an old file can itself have
      // already been deleted by a prior iteration if it were listed twice;
      // guard defensively.
      continue;
    }
    const oldHistory: CanonicalFishHistory = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const oldCanonicalFishId = oldHistory.canonicalFishId;
    const newCanonicalFishId = canonicalizeGenusSynonymFishId(oldCanonicalFishId);
    if (newCanonicalFishId === oldCanonicalFishId) {
      continue; // not under a synonym genus -- nothing to do.
    }

    const mergedIntoExisting = readHistoryFile(dataDir, newCanonicalFishId) !== undefined;

    let remaining: CanonicalFishHistory | undefined = oldHistory;
    let target = readHistoryFile(dataDir, newCanonicalFishId);
    let listingsMoved = 0;
    let eventsMoved = 0;

    // Move every Listing the old file carries, one at a time, reusing the
    // same remove/merge pair used elsewhere for a Listing's canonicalFishId
    // changing between runs (see module doc).
    for (const listingInfo of oldHistory.listings) {
      const { remainingHistory, movedEvents } = removeListingFromHistory(remaining!, listingInfo.listingId);
      remaining = remainingHistory;
      listingsMoved++;
      eventsMoved += movedEvents.length;
      target = mergeListingIntoHistory({
        existing: target,
        canonicalFishId: newCanonicalFishId,
        listingInfo,
        scientificName: oldHistory.scientificName,
        movedEvents,
        newEvent: undefined,
      });
    }

    if (target) {
      writeHistoryFile(dataDir, target);
    }
    deleteHistoryFile(dataDir, oldCanonicalFishId);

    perFile.push({
      oldFileName: fileName,
      oldCanonicalFishId,
      newCanonicalFishId,
      mergedIntoExisting,
      listingsMoved,
      eventsMoved,
    });
  }

  // Keep index.json's own per-Listing canonicalFishId consistent with
  // wherever its history now actually lives.
  const index = readIndexFile(dataDir);
  let listingsUpdatedInIndex = 0;
  const updatedListings = index.listings.map((listing) => {
    const newId = canonicalizeGenusSynonymFishId(listing.canonicalFishId);
    if (newId === listing.canonicalFishId) {
      return listing;
    }
    listingsUpdatedInIndex++;
    return { ...listing, canonicalFishId: newId };
  });
  if (listingsUpdatedInIndex > 0) {
    writeIndexFile(dataDir, { ...index, listings: updatedListings });
  }

  return {
    filesScanned: fileNames.length,
    filesAffected: perFile.length,
    listingsUpdatedInIndex,
    perFile,
  };
}
