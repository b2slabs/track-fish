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
]);

// A binomial-looking fragment: a capitalized genus word, then either the
// literal "sp." (an undescribed/unspecified species within a genus — a
// legitimate scientific-name convention) or a lowercase species word,
// optionally followed by a third lowercase word (subspecies/variety).
const BINOMIAL = /([A-Z][a-z]{2,})\s+(sp\.|[a-z]{2,})(?:\s+([a-z]{2,}))?/;

const PARENTHETICAL_BINOMIAL = new RegExp(`\\(\\s*${BINOMIAL.source}\\s*\\)`);
const LABELED_BINOMIAL = new RegExp(`scientific\\s*name\\s*[:\\-]?\\s*${BINOMIAL.source}`, 'i');

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
  if (subspecies) {
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

  const fromLabel = matchBinomial(listing.description, LABELED_BINOMIAL);
  if (fromLabel) {
    return fromLabel;
  }

  return matchBinomial(listing.description, PARENTHETICAL_BINOMIAL);
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
