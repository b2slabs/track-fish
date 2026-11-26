/**
 * Extracts a candidate scientific name from a Listing's title or
 * description, for use as the primary cross-store Canonical Fish matching
 * signal (see issue #3).
 *
 * Shopify's public `/products.json` has no dedicated scientific-name
 * field — stores that bother to record one embed it as free text, most
 * commonly a parenthetical binomial in the product title, e.g.
 * "Peugeot Tetra (Hyphessobrycon peugeoti)", or an explicit
 * "Scientific Name: ..." label in the description. This is a heuristic
 * pattern match over that free text, not a real taxonomic parser — it
 * will both miss genuine scientific names written in unexpected formats
 * and occasionally false-positive on a capitalized-word-plus-lowercase-word
 * phrase that merely looks like a binomial (e.g. "Choose one"). A small
 * stopword list guards against the most common of those shapes (variant
 * descriptors like "Locally bred"), but it is not exhaustive. Many
 * products have no scientific name at all; callers must treat a null
 * result as expected, not an error, and fall back to fuzzy common-name
 * matching (see `fuzzy-match.ts`).
 */

// Words that occasionally land in the "Genus species"-shaped slot this
// module's patterns look for, but are never actually part of a scientific
// name — mostly variant/marketing descriptors that ride along in a title
// or description near real binomials.
const STOPWORDS = new Set([
  'bred', 'tank', 'male', 'female', 'pair', 'grade', 'wild', 'caught',
  'local', 'locally', 'captive', 'size', 'inch', 'inches', 'each', 'pack',
  'group', 'school', 'juvenile', 'adult', 'mix', 'assorted', 'mixed',
  'random', 'choose', 'select', 'pick', 'item', 'product', 'color',
  'colors', 'colour', 'colours', 'variety', 'pattern', 'patterns', 'type',
  'types', 'default', 'title', 'option', 'one', 'live', 'arrival',
  'guarantee', 'shipping', 'sold', 'packs', 'multiples', 'rare', 'new',
  'from', 'origin',
  // Added for issue #72's "Title | Second Segment" pipe-format matching
  // (see PIPE_BINOMIAL below), which -- unlike the patterns above --
  // allows a capitalized second word (many Stores title-case their own
  // genuine scientific names, e.g. "Corydoras Panda"), so it leans more
  // heavily on this stopword list to reject the second segment when it's
  // actually another common name or unrelated marketing copy rather than
  // a binomial. These are generic English nouns that showed up as a real
  // false-positive risk in the dataset (store branding, plant-
  // propagation labels, gift cards, generic gear copy) -- no genuine
  // Latin species epithet is ever literally one of these words, so adding
  // them here cannot reject a real binomial.
  'cory', 'tissue', 'culture', 'fern', 'flip', 'aquatics', 'water',
  'spangle', 'high', 'light', 'growth', 'food', 'nano', 'tanks', 'potted',
  'plants', 'galaxy', 'glowlight',
]);

// A binomial-looking fragment: a capitalized genus word, then either the
// literal "sp." (an undescribed/unspecified species within a genus — a
// legitimate scientific-name convention) or a lowercase species word,
// optionally followed by a third lowercase word (subspecies/variety).
//
// The genus/species/subspecies slots are deliberately case-sensitive
// (capital genus, lowercase rest) even where this pattern is embedded in
// an otherwise case-insensitive match (see `matchLabeledBinomial`): many
// Store descriptions follow a "Scientific Name: <name> <Next Label>..."
// or "Scientific Name: <name> <Next sentence>..." shape with no
// separating punctuation, e.g. "Scientific Name: Corydoras Aeneus From
// our tank to your tank!" or "...Corydoras pygmaeus Origin Brazil...". A
// case-insensitive third-word slot would swallow that next capitalized
// word ("From", "Origin") as if it were a lowercase subspecies/variety
// epithet, producing a corrupted name ("Corydoras aeneus from") that
// then permanently diverges from the correctly-extracted "Corydoras
// aeneus" for the same product on another Store (see issue #16). Real
// subspecies/variety epithets are conventionally all-lowercase, so
// case-sensitivity here is the biologically-accurate assumption, not
// just a workaround.
const BINOMIAL = /([A-Z][a-z]{2,})\s+(sp\.|[a-z]{2,})(?:\s+([a-z]{2,}))?/;

// A quoted strain/cultivar name trailing the species (and optional
// subspecies) word(s) -- a common real convention for an undescribed or
// informally-named strain, e.g. `Corydoras aeneus "Venezuela"` or
// `Corydoras panda "Longfin"` (both real Aquatic Arts titles/
// descriptions). Swallowed (not captured -- it never becomes part of the
// normalized name) purely so its presence doesn't stop the enclosing
// `\)` or end-of-segment from matching right after it; see issue #72,
// where this quoted aside otherwise broke PARENTHETICAL_BINOMIAL's
// required "...\s*\)" tail, producing a null extraction for a Listing
// whose binomial was, in every way that matters, right there in the
// title. Tolerates straight and curly quotes.
const QUOTED_STRAIN = `(?:\\s*['"‘’“”][^'"‘’“”]*['"‘’“”])?`;

const PARENTHETICAL_BINOMIAL = new RegExp(`\\(\\s*${BINOMIAL.source}${QUOTED_STRAIN}\\s*\\)`);
// Only the label text itself ("scientific name:") is case-insensitive —
// the binomial that follows it is matched by the case-sensitive BINOMIAL
// pattern above, via `matchLabeledBinomial`.
const LABEL_PREFIX = /scientific\s*name\s*[:\-]?\s*/i;
const ANCHORED_BINOMIAL = new RegExp(`^${BINOMIAL.source}`);

/**
 * A "Genus species" binomial filling an entire pipe-delimited title
 * segment, e.g. flip-aquatics' consistent "Common Name | Scientific Name"
 * title format ("Panda Cory Catfish | Corydoras panda" -- see issue #72).
 * Unlike `BINOMIAL` above, this is deliberately:
 *
 *   - Case-insensitive on every word. Many Stores title-case their own
 *     genuine scientific name in this position ("Corydoras Panda",
 *     "Poecilia Reticulatus") -- case is not a reliable signal here the
 *     way it is for `matchLabeledBinomial`'s run-on-sentence problem,
 *     because there is no following prose to accidentally swallow: this
 *     pattern is anchored to the end of the segment (see below).
 *   - Anchored start-to-end (`^...$`) against the trimmed segment, with
 *     no subspecies/third-word slot. A real second pipe segment that
 *     *isn't* a scientific name is almost always either more than two
 *     words ("Reticulated Hillstream Loach", "Aquarium Beginner Kit") or
 *     carries non-alphabetic characters -- full-segment anchoring to
 *     exactly "word word[, optional quoted strain]" rejects those
 *     structurally, without needing a denylist entry for every one of
 *     them. What's left after that structural filter leans on the
 *     (extended, see STOPWORDS above) stopword list to catch the
 *     remaining two-word false positives ("Color Options", "Tissue
 *     Culture", "Venezuelan Cory").
 *   - A 3-letter-minimum second word (vs. BINOMIAL's 2), which
 *     structurally rejects short connector words like "or"/"to" ("Blue
 *     Bolt Shrimp | Regular or Mostly Blue") without a stopword entry.
 */
const PIPE_BINOMIAL = new RegExp(`^([A-Za-z]{3,})\\s+(sp\\.|[A-Za-z]{3,})${QUOTED_STRAIN}\\s*$`, 'i');

function isPlausible(genus: string, species: string): boolean {
  const g = genus.toLowerCase();
  const s = species.toLowerCase();
  if (STOPWORDS.has(g) || STOPWORDS.has(s)) {
    return false;
  }
  return true;
}

function normalizeMatch(genus: string, species: string, subspecies?: string): string {
  const parts = [capitalize(genus), species.toLowerCase()];
  // A subspecies/variety word that is itself a stopword (e.g. a stray
  // "from"/"origin" that slipped past the case-sensitivity guard above,
  // or genuinely all-lowercase in the source text) is dropped rather
  // than invalidating the whole match -- the genus+species pair is still
  // a confident result on its own (see issue #16).
  if (subspecies && !STOPWORDS.has(subspecies.toLowerCase())) {
    parts.push(subspecies.toLowerCase());
  }
  return parts.join(' ');
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/**
 * Returns a normalized "Genus species[ subspecies]" scientific name
 * extracted from the given title/description, or null if none could be
 * confidently found. Tries, in order of confidence:
 *   1. A parenthetical binomial in the title (stores that include one
 *      almost always put it there intentionally, right next to the
 *      common name).
 *   2. A "Common Name | Scientific Name" pipe-delimited title segment
 *      (issue #72 -- see `PIPE_BINOMIAL`): also title-sourced and just as
 *      intentional as #1, merely a different Store convention for the
 *      same thing.
 *   3. An explicit "Scientific Name: ..." label in the description.
 *   4. A parenthetical binomial anywhere in the description, as a last
 *      resort (lower confidence — more prone to catching an unrelated
 *      aside rather than the product's own identity).
 */
export function extractScientificName(listing: { commonName: string; description: string }): string | null {
  const fromTitle = matchBinomial(listing.commonName, PARENTHETICAL_BINOMIAL);
  if (fromTitle) {
    return fromTitle;
  }

  const fromPipe = matchPipeBinomial(listing.commonName);
  if (fromPipe) {
    return fromPipe;
  }

  const fromLabel = matchLabeledBinomial(listing.description);
  if (fromLabel) {
    return fromLabel;
  }

  return matchBinomial(listing.description, PARENTHETICAL_BINOMIAL);
}

/**
 * Splits `title` on `|` and matches each segment after the first, in
 * order, in full against `PIPE_BINOMIAL` -- see that pattern's doc for
 * why this is full-segment-anchored and case-insensitive. Returns the
 * first segment that matches. Checking every later segment (not just the
 * last) matters because a title can legitimately contain more than one
 * pipe with further marketing copy trailing the scientific name itself,
 * e.g. "Panda garra | Garra flavatra | Best Algae Eater for Nano
 * Aquariums" -- the binomial is the middle segment, not the last.
 */
function matchPipeBinomial(title: string): string | null {
  const segments = title.split('|').slice(1);
  for (const segment of segments) {
    const match = matchBinomial(segment.trim(), PIPE_BINOMIAL);
    if (match) {
      return match;
    }
  }
  return null;
}

/**
 * Finds a case-insensitive "scientific name:" label anywhere in `text`,
 * then matches the case-sensitive BINOMIAL pattern immediately after it.
 * Kept separate from `matchBinomial` because only the label text should
 * be case-insensitive -- the binomial itself must stay case-sensitive
 * (see the comment above `BINOMIAL`).
 */
function matchLabeledBinomial(text: string): string | null {
  if (!text) {
    return null;
  }
  const labelMatch = text.match(LABEL_PREFIX);
  if (!labelMatch || labelMatch.index === undefined) {
    return null;
  }
  const rest = text.slice(labelMatch.index + labelMatch[0].length);
  return matchBinomial(rest, ANCHORED_BINOMIAL);
}

function matchBinomial(text: string, pattern: RegExp): string | null {
  if (!text) {
    return null;
  }
  const match = text.match(pattern);
  if (!match) {
    return null;
  }
  const [, genus, species, subspecies] = match;
  if (species !== 'sp.' && !isPlausible(genus, species)) {
    return null;
  }
  return normalizeMatch(genus, species, subspecies);
}

/**
 * Genus-synonym normalization (issue #90, see also ADR 0002/0004).
 *
 * Taxonomic genus reclassifications routinely split one historically-used
 * genus into several new ones, or move a species from one existing genus
 * into another, without the species epithet changing at all. Stores don't
 * coordinate on which name they use, so the *same* species shows up across
 * the catalog under either its old or new genus -- e.g. the 2021 Corydoras
 * genus split moved many species into newly-erected or resurrected genera
 * (Hoplisoma, Gastrodermus, Scleromystax, ...) while hobbyist/vendor usage
 * of the pre-split "Corydoras" name for those same species remains common
 * and will keep showing up in scraped titles/descriptions indefinitely.
 * `scientificNameSlug` builds the deterministic `cf:sci:<slug>` Canonical
 * Fish id directly from the extracted name (see `canonical-fish.ts`), so
 * without this normalization, two Listings of the same species under
 * different genus names permanently fork into two never-reconciled
 * Canonical Fish entries instead of auto-merging -- exactly the problem
 * `canonical-fish-overrides.ts` otherwise has to patch one Listing at a
 * time (see issue #16's "Gastrodermus hastatus" vs. "Corydoras hastatus").
 *
 * This is a curated genus-level synonym table, in the same spirit as
 * `variety.ts`'s curated keyword list: not a full taxonomic synonymy
 * database, just the real reclassifications observed to matter for this
 * catalog. Each entry maps a synonym genus (lowercase) to the single
 * canonical genus its slug should converge on -- deliberately picking
 * whichever name is currently most common across Stores in practice, not
 * necessarily the taxonomically "correct" or most recent one; the goal is
 * convergence, not correctness of nomenclature. Mapping happens at the
 * genus token only -- the species (and subspecies) word is never touched
 * -- so two genuinely different species that happen to share a synonym
 * genus (e.g. "Hoplisoma panda" vs. a hypothetical "Hoplisoma sp. black")
 * still land on different slugs, because their species words still
 * differ. Extend this table as new real reclassification cases surface,
 * the same way `canonical-fish-overrides.ts` accumulates maintainer fixes
 * and `variety.ts`'s `VARIETY_TERMS` grows over time -- no new rationale
 * needs to be re-derived for a straightforward "genus X is a synonym of
 * genus Y for slug purposes" addition; just add the entry.
 *
 * Deliberately NOT applied to the human-readable `scientificName` string
 * itself (only to the id-building slug) -- the extracted name as written
 * by the Store is still what gets stored/displayed, so a maintainer
 * reading history data sees exactly what the Store wrote, not a
 * silently-substituted genus.
 */
const GENUS_SYNONYMS: Record<string, string> = {
  // 2021 Corydoras genus split (Tencati-Perez et al.) moved many species
  // long sold under "Corydoras" into newly-erected or resurrected genera.
  // Hobbyist/vendor usage of the pre-split name remains dominant and will
  // keep appearing in scraped titles/descriptions indefinitely, so this
  // normalizes back onto "corydoras" (the name still most common across
  // Stores at the time of this fix) rather than onto the newer name.
  hoplisoma: 'corydoras', // e.g. Corydoras/Hoplisoma panda (issue #90)
  gastrodermus: 'corydoras', // e.g. Corydoras/Gastrodermus hastatus (issue #16, #90)
};

/**
 * Normalizes a scientific name into a stable slug for use as a Canonical
 * Fish id suffix, e.g. "Hyphessobrycon peugeoti" -> "hyphessobrycon-peugeoti".
 * The genus token is first run through `GENUS_SYNONYMS` (see above) so
 * that two scientific names differing only by a known genus synonym
 * converge on the same slug.
 */
export function scientificNameSlug(scientificName: string): string {
  const [genus, ...rest] = scientificName.split(' ');
  const canonicalGenus = GENUS_SYNONYMS[genus.toLowerCase()] ?? genus;
  return [canonicalGenus, ...rest]
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
