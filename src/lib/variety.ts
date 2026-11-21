/**
 * Variety/color-morph detection for Canonical Fish identity (see issue
 * #34 and `docs/adr/0002-canonical-fish-is-species-level.md`, amended by
 * `docs/adr/0004-variety-is-part-of-canonical-fish-identity.md`).
 *
 * Canonical Fish identity used to be species-only: two Listings of the
 * same species (same scientific name, or a confident fuzzy common-name
 * match) always shared one Canonical Fish, regardless of color morph or
 * named variety. In practice that merged genuinely different,
 * separately-marketed products -- "Albino Cory", "Bronze Cory", and
 * "Orange Venezuelan Cory" (all nominally *Corydoras aeneus*) landed in
 * one group, and Medaka varieties ("Platinum Medaka", "Black Medaka",
 * "Galaxy Medaka", ...) landed in another, worse, because most Medaka
 * listings have no extractable scientific name at all and were purely
 * fuzzy-matched on the shared base noun "Medaka".
 *
 * This module extracts a normalized "variety signature" from a
 * Listing's common name: a sorted, deduplicated list of recognized
 * color/pattern/fin-type keywords. Two signatures are compared with
 * `varietyCompatible` -- exactly equal (including both empty, meaning
 * "no variety detected" / plain wild-type) counts as the same identity;
 * anything else (including one side having a detected variety and the
 * other not) does not. `canonical-fish.ts` folds a non-empty signature
 * into the deterministic `cf:sci:<slug>` id (`cf:sci:<slug>:<variety>`)
 * and gates fuzzy common-name candidates on compatibility before scoring
 * them, so the two failure modes above are both covered: same species,
 * different variety word (gets a different id outright) and no species
 * at all, fuzzy match dominated by the shared base noun (gated out
 * before the shared "medaka"/"cory" token can carry the match).
 *
 * This is deliberately a curated keyword list, not a taxonomy or a full
 * morph vocabulary -- see the module-level limitations below, in the
 * same spirit as `scientific-name.ts`'s binomial heuristic.
 *
 * Known limitations (deliberate, not oversights):
 *
 *   - Only the common name (title) is scanned, never the description.
 *     Color/morph words are reliably marketing copy in the title across
 *     every Store seen so far; a variety mentioned only in body text
 *     would be missed. Cheaper and safer than also mining free-text
 *     descriptions, which raises the false-positive rate for little
 *     additional coverage.
 *   - The term list is intentionally not exhaustive. It covers common
 *     colors, a handful of well-known patterns/morphs, and fin-type
 *     modifiers -- enough to separate the reported real cases -- but an
 *     unlisted strain name (e.g. many single-use Japanese Medaka
 *     cultivar names like "Youkihi", "Miyuki", "Komachi", "Shukougyoku")
 *     will not be detected and such Listings will still be treated as
 *     plain/wild-type, so they can still over-merge with each other or
 *     with a genuinely plain Listing. Extend `VARIETY_TERMS` as new
 *     real-world cases surface, the same way `canonical-fish-overrides.ts`
 *     accumulates maintainer fixes.
 *   - Geographic/origin qualifiers ("Venezuelan", "Peruvian", wild-caught
 *     locality names, ...) are deliberately NOT treated as variety, even
 *     though they occasionally do distinguish a marketed strain. Most of
 *     the time they're just sourcing/origin trivia (already excluded
 *     from identity per ADR 0002), and the color/pattern/fin-type words
 *     usually riding alongside them are enough to separate the cases
 *     that matter (e.g. "Orange Venezuelan Cory" differs from "Bronze
 *     Cory" on "orange" vs "bronze" alone).
 *   - A term can coincide with a word that is itself the base common
 *     name of an unrelated species (e.g. "Koi" the carp vs. "Koi Betta"
 *     the color pattern). Variety detection runs uniformly regardless of
 *     species context, so a plain "Koi" listing gets a non-empty
 *     signature. This is harmless in practice -- it only matters when
 *     compared against another Listing, and two actual Koi carp
 *     Listings will consistently produce the same signature.
 *   - Exact-signature equality, not subset/overlap: "Red Cory" and "Red
 *     Longfin Cory" are treated as fully different varieties rather than
 *     one being a specialization of the other. Simpler and erring
 *     toward separation (matching this issue's intent) rather than
 *     collapsing two listings that may genuinely be different products.
 */

// Each entry is one recognized variety, keyed by a stable slug (used in
// the Canonical Fish id) with one or more surface-text aliases that
// resolve to it. Aliases are matched as whole words/phrases (not
// substrings) against the normalized common name. List roughly
// longest-alias-first within each entry only for readability; matching
// itself does not depend on declaration order.
const VARIETY_TERMS: { slug: string; aliases: string[] }[] = [
  // Colors
  { slug: 'albino', aliases: ['albino'] },
  { slug: 'bronze', aliases: ['bronze'] },
  { slug: 'orange', aliases: ['orange'] },
  { slug: 'red', aliases: ['red'] },
  { slug: 'green', aliases: ['green'] },
  { slug: 'blue', aliases: ['blue'] },
  { slug: 'black', aliases: ['black'] },
  { slug: 'white', aliases: ['white'] },
  { slug: 'platinum', aliases: ['platinum'] },
  { slug: 'gold', aliases: ['gold', 'golden'] },
  { slug: 'silver', aliases: ['silver'] },
  { slug: 'purple', aliases: ['purple'] },
  { slug: 'yellow', aliases: ['yellow'] },
  { slug: 'pink', aliases: ['pink'] },
  { slug: 'copper', aliases: ['copper'] },
  { slug: 'brown', aliases: ['brown'] },
  { slug: 'grey', aliases: ['grey', 'gray'] },
  { slug: 'chocolate', aliases: ['chocolate'] },
  { slug: 'lavender', aliases: ['lavender'] },

  // Named patterns/morphs
  { slug: 'galaxy', aliases: ['galaxy'] },
  { slug: 'koi', aliases: ['koi'] },
  { slug: 'panda', aliases: ['panda'] },
  { slug: 'marble', aliases: ['marble'] },
  { slug: 'calico', aliases: ['calico'] },
  { slug: 'tiger', aliases: ['tiger'] },
  { slug: 'leopard', aliases: ['leopard'] },
  { slug: 'dragon', aliases: ['dragon scale', 'dragonscale', 'dragon'] },
  { slug: 'glofish', aliases: ['glofish', 'glo fish'] },
  { slug: 'neon', aliases: ['neon'] },
  { slug: 'electric', aliases: ['electric'] },
  { slug: 'sparkle', aliases: ['sparkle'] },
  { slug: 'pearl', aliases: ['pearl'] },
  { slug: 'tuxedo', aliases: ['tuxedo'] },
  { slug: 'moscow', aliases: ['moscow'] },
  { slug: 'mustard', aliases: ['mustard'] },
  { slug: 'dalmatian', aliases: ['dalmatian'] },

  // Fin-type modifiers
  { slug: 'hifin', aliases: ['hifin', 'hi fin', 'highfin', 'high fin'] },
  { slug: 'longfin', aliases: ['longfin', 'long fin'] },
  { slug: 'shortfin', aliases: ['shortfin', 'short fin'] },
  { slug: 'sailfin', aliases: ['sailfin', 'sail fin'] },
  { slug: 'veiltail', aliases: ['veiltail', 'veil tail'] },
  { slug: 'crowntail', aliases: ['crowntail', 'crown tail'] },
  { slug: 'halfmoon', aliases: ['halfmoon', 'half moon'] },
];

/** Lowercases, strips parenthetical asides and punctuation, and collapses
 * whitespace -- matches `fuzzy-match.ts`'s `normalizeCommonName` shape so
 * variety detection and fuzzy scoring agree on what counts as the "bare"
 * common name. */
function normalize(name: string): string {
  return name
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function hasAlias(normalized: string, alias: string): boolean {
  return new RegExp(`(?:^|\\s)${alias.replace(/\s+/g, '\\s+')}(?:$|\\s)`).test(normalized);
}

/**
 * Extracts the variety signature from a Listing's common name: a sorted,
 * deduplicated list of recognized variety term slugs, or an empty array
 * if none were found (plain/wild-type). See the module doc for what
 * "recognized" means and its limitations.
 */
export function extractVariety(commonName: string): string[] {
  const normalized = normalize(commonName);
  const matched = new Set<string>();
  for (const term of VARIETY_TERMS) {
    if (term.aliases.some((alias) => hasAlias(normalized, alias))) {
      matched.add(term.slug);
    }
  }
  return [...matched].sort();
}

/** Joins an already-extracted variety signature into a Canonical Fish id
 * suffix, e.g. `['albino', 'hifin'] -> 'albino-hifin'`. Callers should
 * only call this when the signature is non-empty. */
export function varietySlug(variety: string[]): string {
  return variety.join('-');
}

/**
 * Whether two variety signatures are compatible -- i.e. whether two
 * Listings with these signatures may share one Canonical Fish. Both
 * empty (neither detected a variety -- plain/wild-type on both sides)
 * counts as compatible; so does an exact match of detected terms.
 * Anything else -- including one side detecting a variety and the other
 * not -- does not, per issue #34's identity rule: "same species AND
 * variety (or both have no detected variety)".
 */
export function varietyCompatible(a: string[], b: string[]): boolean {
  if (a.length === 0 && b.length === 0) {
    return true;
  }
  if (a.length !== b.length) {
    return false;
  }
  return a.every((term, i) => term === b[i]);
}
