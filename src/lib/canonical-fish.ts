import type {
  CanonicalFishHistory,
  CanonicalFishHistoryEvent,
  CanonicalFishHistoryListing,
  HistoryEvent,
} from '../types/listing.js';
import type { CanonicalFishOverride } from '../config/canonical-fish-overrides.js';
import { extractScientificName, scientificNameSlug } from './scientific-name.js';
import { commonNameSimilarity, tokenize } from './fuzzy-match.js';
import { extractVariety, varietyCompatible, varietySlug } from './variety.js';

/**
 * Cross-store Canonical Fish matching (see issue #3 and
 * `docs/adr/0002-canonical-fish-is-species-level.md`): a hybrid of three
 * signals —
 *
 *   1. A maintainer override (`src/config/canonical-fish-overrides.ts`)
 *      always wins — it resolves whatever the automatic signals below
 *      got ambiguous or wrong.
 *   2. A scientific name extracted from the Listing's own title/
 *      description (see `scientific-name.ts`). Deterministic: the
 *      Canonical Fish id is derived directly from the normalized name
 *      (`cf:sci:<slug>`), so any two Listings — same Store or different
 *      Stores, any processing order — land on the same id without a
 *      lookup, *provided they extracted the same name*. This is
 *      deliberately not size/grade-aware (ADR 0002): two Listings of the
 *      same species at different sizes still share one Canonical Fish.
 *   3. Fuzzy common-name matching against Listings already known from a
 *      *different* Store (see `fuzzy-match.ts`). A high-confidence match
 *      auto-merges; a mid-confidence one is "ambiguous" and is
 *      deliberately NOT auto-merged — it falls back to this Listing's
 *      own id, with the candidate recorded in `pending-matches.json` for
 *      a maintainer to resolve via an override.
 *
 * Signal 2 is deterministic but not infallible: two Stores can describe
 * the same species with two different extracted names — a vendor-specific
 * synonym, an outdated genus, a typo — that will never collide as the
 * same slug. Left alone, that would permanently fork one species into two
 * never-reconciled Canonical Fish entries (see issue #16: "Tail Spot
 * Pygmy Cory (Gastrodermus hastatus)" vs "... (Corydoras hastatus)").
 * So signal 3 is *also* checked when a scientific name was found: if the
 * best fuzzy common-name candidate belongs to an already-established,
 * different Canonical Fish and is confident enough, that existing group
 * wins over minting a fresh `cf:sci:<slug>` id.
 *
 * That reconciliation is deliberately guarded by one more condition: it
 * only fires when this Listing's *own* `cf:sci:<slug>` id has no existing
 * cross-store members yet. Without that guard, a brand-new, correctly-
 * extracted scientific name can be hijacked away from its own (legitimate,
 * about-to-be-established) group into an unrelated, already-larger rival
 * group purely because of an incidental fuzzy-score tie — which is exactly
 * what happened chasing issue #16 in practice: "Phoenix Rasbora (Boraras
 * merah)" Listings with a clean, title-parenthetical scientific name were
 * getting pulled into a completely different, already-corrupted
 * `cf:sci:boraras-merah-we` group (itself the product of the very
 * mis-extraction bug this fix addresses, from a different Store's
 * unrelated Listing) rather than keeping their own correct
 * `cf:sci:boraras-merah` — simply because that corrupted group happened
 * to iterate first and tie at the same score. Once a `cf:sci:<slug>` id
 * already has independent cross-store corroboration, it is strong enough
 * evidence of its own correctness that a same-wording rival must not be
 * allowed to override it; only a *fresh* slug with no such corroboration
 * (the genuine vendor-synonym case) defers to a confident fuzzy rival.
 *
 * A Listing that matches none of the above keeps the trivial,
 * single-Listing `cf:${storeSlug}:${productIdentifier}` id it always
 * had, in its own distinct namespace so it can be repointed later
 * without disturbing its listingId or any already-written history.
 *
 * Variety/color-morph (issue #34, see `variety.ts`): since ADR 0002 was
 * amended, Canonical Fish identity is species AND variety, not species
 * alone -- two genuinely different, separately-marketed color morphs of
 * the same species (e.g. "Albino Cory" vs "Bronze Cory", both nominally
 * *Corydoras aeneus*) must land on different Canonical Fish entries.
 * This is folded into both signals above rather than being a fourth,
 * separate signal: a detected variety is appended to the deterministic
 * `cf:sci:<slug>` id (`cf:sci:<slug>:<variety>`), so two same-species,
 * different-variety Listings mint different ids outright; and every
 * fuzzy common-name comparison (signal 3, including the sci-name rival
 * check) is additionally gated on `varietyCompatible` before scoring, so
 * a shared base noun ("Cory", "Medaka") can no longer carry a match
 * across a variety mismatch the way it used to.
 */

export type MatchStatus = 'override' | 'scientific-name' | 'fuzzy-auto' | 'ambiguous' | 'unmatched';

export interface AmbiguousCandidate {
  canonicalFishId: string;
  commonName: string;
  score: number;
}

export interface MatchResult {
  canonicalFishId: string;
  status: MatchStatus;
  scientificName: string | null;
  /** Present only when status is 'ambiguous'. */
  ambiguousCandidate?: AmbiguousCandidate;
}

/** A fuzzy-match candidate: one Canonical Fish, represented by every
 * common name any already-known Listing has used for it, tagged with
 * which Store contributed it (see `findBestFuzzyCandidate`'s per-name,
 * not just per-candidate, same-Store exclusion). */
interface FuzzyCandidate {
  canonicalFishId: string;
  commonNames: { commonName: string; storeSlug: string }[];
}

export interface MatchContext {
  storeSlug: string;
  overridesByListingId: Map<string, string>;
  candidatesByToken: Map<string, FuzzyCandidate[]>;
  /** Every Canonical Fish id that already has cross-store corroboration
   * (see `buildMatchContext`) — used to guard against a fuzzy rival
   * hijacking an already-established `cf:sci:<slug>` group. */
  candidateIds: Set<string>;
}

/** A fuzzy-match score of this or higher auto-merges into the candidate. */
export const AUTO_MERGE_THRESHOLD = 0.85;
/** A fuzzy-match score of this or higher (but below AUTO_MERGE_THRESHOLD)
 * is "ambiguous": recorded for a maintainer, not auto-merged. */
export const AMBIGUOUS_THRESHOLD = 0.6;

/**
 * Builds the reusable per-Store-run matching context: the override
 * lookup, plus an inverted token index over every other Store's already-
 * known Listings, so fuzzy matching doesn't have to linearly scan the
 * full catalog for every Listing. Build once per `processStoreRun` call,
 * not once per Listing.
 *
 * The fuzzy candidate pool deliberately excludes Canonical Fish entries
 * whose only Listings are from `storeSlug` itself — fuzzy wording
 * similarity is a cross-store identity heuristic (two sellers describing
 * the same species similarly), not a signal for merging two genuinely
 * different products a single Store happens to word similarly. Each
 * commonName is also individually tagged with its Store (see
 * `findBestFuzzyCandidate`): a Canonical Fish id can have cross-store
 * membership overall while one specific commonName in its history still
 * came from `storeSlug` itself (most commonly: this exact Listing's own
 * commonName, from before this run touched it) — that specific name must
 * not be allowed to fuzzy-match this run's Listing right back onto the id
 * it's being freshly computed for, which would be comparing a Store's
 * Listing against itself under a different name.
 *
 * Variety-split grouping (issue #34): a `cf:sci:<slug>` id can predate
 * this fix, or predate every Listing that currently shares it getting a
 * chance to individually recompute its own id this run, and so can still
 * carry more than one distinct variety signature in its history --
 * exactly the historical contamination this issue reports. Nothing
 * retroactively un-mixes an already-written history file, but new
 * matching must not keep reinforcing that mix: two same-variety Listings
 * sharing a contaminated `cf:sci:<slug>` id should still match each other
 * (that pairing is correct), but must not drag in a third, different-
 * variety Listing just because all three happen to share the same
 * underlying id string. So each existing Listing is grouped by
 * `resolvedGroupId` -- its own commonName's variety folded into its
 * stored id as a suffix, unless that id already ends in exactly that
 * suffix -- rather than by the raw stored id. A `cf:sci:<slug>` id with
 * one clean variety keeps matching as a single group, same as always;
 * one that has drifted into carrying several splits into one resolved
 * group per variety on this and future runs, each independently
 * reachable, until every Listing that contributed to the mix has been
 * individually reprocessed onto its own resolved id.
 */
export function buildMatchContext(
  storeSlug: string,
  existingListings: { canonicalFishId: string; storeSlug: string; commonName: string }[],
  overrides: CanonicalFishOverride[]
): MatchContext {
  const overridesByListingId = new Map(overrides.map((o) => [o.listingId, o.canonicalFishId]));

  const namesById = new Map<string, Map<string, { commonName: string; storeSlug: string }>>();
  const storeSlugsById = new Map<string, Set<string>>();
  for (const listing of existingListings) {
    const groupId = resolvedGroupId(listing.canonicalFishId, extractVariety(listing.commonName));
    if (!namesById.has(groupId)) {
      namesById.set(groupId, new Map());
      storeSlugsById.set(groupId, new Set());
    }
    namesById
      .get(groupId)!
      .set(`${listing.storeSlug} ${listing.commonName}`, { commonName: listing.commonName, storeSlug: listing.storeSlug });
    storeSlugsById.get(groupId)!.add(listing.storeSlug);
  }

  const candidatesByToken = new Map<string, FuzzyCandidate[]>();
  const candidateIds = new Set<string>();
  for (const [canonicalFishId, names] of namesById) {
    const storeSlugs = storeSlugsById.get(canonicalFishId)!;
    const isCrossStoreCandidate = [...storeSlugs].some((slug) => slug !== storeSlug);
    if (!isCrossStoreCandidate) {
      continue;
    }
    candidateIds.add(canonicalFishId);
    const candidate: FuzzyCandidate = { canonicalFishId, commonNames: [...names.values()] };
    const tokens = new Set(candidate.commonNames.flatMap(({ commonName }) => tokenize(commonName)));
    for (const token of tokens) {
      const list = candidatesByToken.get(token) ?? [];
      list.push(candidate);
      candidatesByToken.set(token, list);
    }
  }

  return { storeSlug, overridesByListingId, candidatesByToken, candidateIds };
}

/**
 * Folds `variety` into `rawId` as a suffix, unless `rawId` already ends
 * in exactly that suffix or `variety` is empty -- see the variety-split
 * grouping note in `buildMatchContext`'s doc. Scoped to the `cf:sci:`
 * namespace only: a trivial `cf:<store>:<productIdentifier>` id is
 * already maximally specific (one Listing) and never needs a suffix
 * synthesized onto it.
 */
function resolvedGroupId(rawId: string, variety: string[]): string {
  if (variety.length === 0 || !rawId.startsWith('cf:sci:')) {
    return rawId;
  }
  const suffix = `:${varietySlug(variety)}`;
  return rawId.endsWith(suffix) ? rawId : `${rawId}${suffix}`;
}

export function matchCanonicalFish(
  parsed: { productIdentifier: string; commonName: string; description: string },
  context: MatchContext
): MatchResult {
  const { storeSlug } = context;
  const listingId = `${storeSlug}:${parsed.productIdentifier}`;
  const trivialCanonicalFishId = `cf:${listingId}`;
  const scientificName = extractScientificName(parsed);
  const variety = extractVariety(parsed.commonName);
  const varietySuffix = variety.length > 0 ? `:${varietySlug(variety)}` : '';
  const sciCanonicalFishId = scientificName ? `cf:sci:${scientificNameSlug(scientificName)}${varietySuffix}` : null;

  const override = context.overridesByListingId.get(listingId);
  if (override) {
    return { canonicalFishId: override, status: 'override', scientificName };
  }

  const best = findBestFuzzyCandidate(parsed.commonName, variety, context);

  if (sciCanonicalFishId) {
    // Only defer to a fuzzy rival when this Listing's own scientific-name
    // id has no existing cross-store corroboration yet -- see the module
    // doc for why an already-established id must not be hijacked by a
    // same-scoring rival.
    const ownIdAlreadyEstablished = context.candidateIds.has(sciCanonicalFishId);
    const rival =
      !ownIdAlreadyEstablished && best && best.candidate.canonicalFishId !== sciCanonicalFishId ? best : undefined;

    if (rival && rival.score >= AUTO_MERGE_THRESHOLD) {
      return { canonicalFishId: rival.candidate.canonicalFishId, status: 'fuzzy-auto', scientificName };
    }
    if (rival && rival.score >= AMBIGUOUS_THRESHOLD) {
      // Confident enough to flag, not confident enough to override a
      // deterministic signal outright -- stays on its own scientific-name
      // id, with the rival recorded for a maintainer.
      return {
        canonicalFishId: sciCanonicalFishId,
        status: 'ambiguous',
        scientificName,
        ambiguousCandidate: {
          canonicalFishId: rival.candidate.canonicalFishId,
          commonName: rival.candidate.commonNames[0].commonName,
          score: rival.score,
        },
      };
    }
    return { canonicalFishId: sciCanonicalFishId, status: 'scientific-name', scientificName };
  }

  // No scientific name at all -- plain fuzzy common-name matching, same
  // as before issue #16.
  if (best && best.score >= AUTO_MERGE_THRESHOLD) {
    return { canonicalFishId: best.candidate.canonicalFishId, status: 'fuzzy-auto', scientificName: null };
  }
  if (best && best.score >= AMBIGUOUS_THRESHOLD) {
    return {
      canonicalFishId: trivialCanonicalFishId,
      status: 'ambiguous',
      scientificName: null,
      ambiguousCandidate: {
        canonicalFishId: best.candidate.canonicalFishId,
        commonName: best.candidate.commonNames[0].commonName,
        score: best.score,
      },
    };
  }

  return { canonicalFishId: trivialCanonicalFishId, status: 'unmatched', scientificName: null };
}

/**
 * Finds the best-scoring fuzzy candidate for `commonName`, gated two
 * ways before a name is allowed to contribute to a candidate's score:
 *
 *   1. Same-Store exclusion: a commonName sourced from `context.storeSlug`
 *      itself is skipped, even inside an otherwise-legitimate cross-store
 *      candidate. Without this, a Listing being freshly (re)matched this
 *      run can fuzzy-match its own prior-run commonName (identical text,
 *      score 1.0) sitting in the pool from before this run started,
 *      perpetually re-anchoring it to whatever id it already had instead
 *      of letting it land on a freshly-computed one.
 *   2. Variety compatibility (issue #34): a name only contributes when
 *      its own detected variety is compatible with `variety` (see
 *      `varietyCompatible` in `variety.ts`). A candidate with every name
 *      excluded by either gate is skipped entirely -- it is not merely
 *      scored at 0, which would still let it lose to an even-worse-but-
 *      eligible rival; it simply isn't a candidate for this Listing. This
 *      is what stops a shared base noun ("Cory", "Medaka") from carrying
 *      a fuzzy match across a genuine color/variety mismatch.
 */
function findBestFuzzyCandidate(
  commonName: string,
  variety: string[],
  context: MatchContext
): { candidate: FuzzyCandidate; score: number } | undefined {
  const seen = new Set<string>();
  let best: { candidate: FuzzyCandidate; score: number } | undefined;

  for (const token of tokenize(commonName)) {
    const candidates = context.candidatesByToken.get(token);
    if (!candidates) {
      continue;
    }
    for (const candidate of candidates) {
      if (seen.has(candidate.canonicalFishId)) {
        continue;
      }
      seen.add(candidate.canonicalFishId);
      const eligibleScores = candidate.commonNames
        .filter((name) => name.storeSlug !== context.storeSlug)
        .filter((name) => varietyCompatible(variety, extractVariety(name.commonName)))
        .map((name) => commonNameSimilarity(commonName, name.commonName));
      if (eligibleScores.length === 0) {
        continue;
      }
      const score = Math.max(...eligibleScores);
      if (!best || score > best.score) {
        best = { candidate, score };
      }
    }
  }

  return best;
}

// --- History repointing -----------------------------------------------
//
// A Listing's canonicalFishId can change between runs (it gets a
// scientific-name match it didn't have before, a fuzzy match appears or
// disappears as the candidate pool changes, or a maintainer adds/edits an
// override). When that happens, this Listing's events must move from its
// old Canonical Fish's history file to its new one — not be left behind
// (lost) and not be copied into both (duplicated).

/**
 * Removes every event belonging to `listingId` out of `history`. Returns
 * the remaining history (or undefined if this was the last Listing
 * contributing to it, meaning the whole file should be deleted) plus the
 * events that were moved out, for the caller to merge into the new
 * target history.
 */
export function removeListingFromHistory(
  history: CanonicalFishHistory,
  listingId: string
): { remainingHistory: CanonicalFishHistory | undefined; movedEvents: CanonicalFishHistoryEvent[] } {
  const movedEvents = history.events.filter((event) => event.listingId === listingId);
  const remainingEvents = history.events.filter((event) => event.listingId !== listingId);
  const remainingListings = history.listings.filter((listing) => listing.listingId !== listingId);

  if (remainingListings.length === 0) {
    return { remainingHistory: undefined, movedEvents };
  }

  return {
    remainingHistory: { ...history, events: remainingEvents, listings: remainingListings },
    movedEvents,
  };
}

function eventKey(event: CanonicalFishHistoryEvent): string {
  return `${event.listingId}:${event.observedAt}`;
}

/**
 * Merges one Listing's new HistoryEvent (plus, on a repoint, any events
 * moved over from its old Canonical Fish) into `existing` — the target
 * Canonical Fish's current history, or undefined if this is the first
 * time anything has been recorded under this id.
 */
export function mergeListingIntoHistory(params: {
  existing: CanonicalFishHistory | undefined;
  canonicalFishId: string;
  listingInfo: CanonicalFishHistoryListing;
  scientificName: string | null;
  movedEvents: CanonicalFishHistoryEvent[];
  newEvent: HistoryEvent;
}): CanonicalFishHistory {
  const { canonicalFishId, listingInfo, scientificName, movedEvents, newEvent } = params;
  const existing = params.existing;

  const listings = existing?.listings.some((listing) => listing.listingId === listingInfo.listingId)
    ? existing.listings.map((listing) => (listing.listingId === listingInfo.listingId ? listingInfo : listing))
    : [...(existing?.listings ?? []), listingInfo];

  const taggedNewEvent: CanonicalFishHistoryEvent = {
    ...newEvent,
    listingId: listingInfo.listingId,
    storeSlug: listingInfo.storeSlug,
  };

  const existingKeys = new Set((existing?.events ?? []).map(eventKey));
  const incomingMoved = movedEvents.filter((event) => !existingKeys.has(eventKey(event)));

  const events = [...(existing?.events ?? []), ...incomingMoved, taggedNewEvent].sort((a, b) =>
    a.observedAt.localeCompare(b.observedAt)
  );

  return {
    canonicalFishId,
    commonName: listingInfo.commonName,
    scientificName: existing?.scientificName ?? scientificName,
    listings,
    events,
  };
}

/**
 * Upgrades a history file written before issue #3 (one Listing per
 * Canonical Fish, so `listingId`/`storeSlug`/`commonName` lived at the
 * top level instead of per-event) into the current shape, in memory.
 * Nothing on disk changes until the caller next writes the file — which
 * happens naturally the next time that Listing is reprocessed.
 */
export function migrateLegacyHistory(raw: unknown): CanonicalFishHistory {
  const legacy = raw as {
    canonicalFishId: string;
    listingId: string;
    storeSlug: string;
    commonName: string;
    events: HistoryEvent[];
  };

  return {
    canonicalFishId: legacy.canonicalFishId,
    commonName: legacy.commonName,
    scientificName: null,
    listings: [
      {
        listingId: legacy.listingId,
        storeSlug: legacy.storeSlug,
        storeName: legacy.storeSlug,
        commonName: legacy.commonName,
      },
    ],
    events: legacy.events.map((event) => ({
      ...event,
      listingId: legacy.listingId,
      storeSlug: legacy.storeSlug,
    })),
  };
}

export function isLegacyHistory(raw: unknown): boolean {
  return (
    !!raw &&
    typeof raw === 'object' &&
    typeof (raw as { listingId?: unknown }).listingId === 'string' &&
    !Array.isArray((raw as { listings?: unknown }).listings)
  );
}
