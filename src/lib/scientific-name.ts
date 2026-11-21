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

const PARENTHETICAL_BINOMIAL = new RegExp(`\\(\\s*${BINOMIAL.source}\\s*\\)`);
// Only the label text itself ("scientific name:") is case-insensitive —
// the binomial that follows it is matched by the case-sensitive BINOMIAL
// pattern above, via `matchLabeledBinomial`.
const LABEL_PREFIX = /scientific\s*name\s*[:\-]?\s*/i;
const ANCHORED_BINOMIAL = new RegExp(`^${BINOMIAL.source}`);

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
 *   2. An explicit "Scientific Name: ..." label in the description.
 *   3. A parenthetical binomial anywhere in the description, as a last
 *      resort (lower confidence — more prone to catching an unrelated
 *      aside rather than the product's own identity).
 */
export function extractScientificName(listing: { commonName: string; description: string }): string | null {
  const fromTitle = matchBinomial(listing.commonName, PARENTHETICAL_BINOMIAL);
  if (fromTitle) {
    return fromTitle;
  }

  const fromLabel = matchLabeledBinomial(listing.description);
  if (fromLabel) {
    return fromLabel;
  }

  return matchBinomial(listing.description, PARENTHETICAL_BINOMIAL);
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
 * Normalizes a scientific name into a stable slug for use as a Canonical
 * Fish id suffix, e.g. "Hyphessobrycon peugeoti" -> "hyphessobrycon-peugeoti".
 */
export function scientificNameSlug(scientificName: string): string {
  return scientificName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
