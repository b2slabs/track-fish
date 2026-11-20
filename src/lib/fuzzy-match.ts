/**
 * Fuzzy common-name matching: the fallback cross-store Canonical Fish
 * signal for Listings with no reliable scientific name (see issue #3).
 * Two normalization-and-compare strategies are blended — a character-level
 * edit-distance ratio (catches near-identical names with minor wording
 * differences) and a token-overlap ratio (catches reordered or
 * partially-overlapping wording) — and the higher of the two is used,
 * since either alone misses cases the other catches.
 *
 * This is deliberately simple string similarity, not a taxonomy or
 * synonym lookup: two differently-worded common names for the same fish
 * (e.g. "Koi Betta" vs. "Dragon Scale Betta") will not match here, and
 * two similarly-worded names for different fish occasionally will. That
 * is why callers treat a mid-range score as "ambiguous" rather than
 * either auto-merging or ignoring it (see `canonical-fish.ts`).
 */

const STOPWORDS = new Set([
  'the', 'and', 'of', 'a', 'an', 'for', 'with', 'pack', 'group', 'pair',
  'male', 'female', 'bred', 'tank', 'wild', 'caught', 'grade', 'juvenile',
  'adult', 'small', 'medium', 'large', 'xl', 'sold', 'in', 'packs',
  'multiples', 'live', 'rare',
]);

/** Lowercases, strips parenthetical asides and punctuation, and collapses whitespace. */
export function normalizeCommonName(name: string): string {
  return name
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/** Normalized, stopword-filtered tokens of at least 3 characters. */
export function tokenize(name: string): string[] {
  return normalizeCommonName(name)
    .split(' ')
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

function levenshtein(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  if (a.length === 0) {
    return b.length;
  }
  if (b.length === 0) {
    return a.length;
  }

  let previousRow = Array.from({ length: b.length + 1 }, (_, j) => j);

  for (let i = 1; i <= a.length; i++) {
    const currentRow = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      currentRow.push(
        Math.min(
          previousRow[j] + 1, // deletion
          currentRow[j - 1] + 1, // insertion
          previousRow[j - 1] + cost // substitution
        )
      );
    }
    previousRow = currentRow;
  }

  return previousRow[b.length];
}

function characterSimilarity(a: string, b: string): number {
  const maxLength = Math.max(a.length, b.length, 1);
  return 1 - levenshtein(a, b) / maxLength;
}

function tokenSimilarity(tokensA: string[], tokensB: string[]): number {
  if (tokensA.length === 0 || tokensB.length === 0) {
    return 0;
  }
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  const intersectionSize = [...setA].filter((token) => setB.has(token)).length;
  const unionSize = new Set([...setA, ...setB]).size;
  return intersectionSize / unionSize;
}

/**
 * A similarity score in [0, 1] between two common names: the higher of a
 * normalized character-edit-distance ratio and a token-overlap ratio.
 */
export function commonNameSimilarity(a: string, b: string): number {
  const normalizedA = normalizeCommonName(a);
  const normalizedB = normalizeCommonName(b);
  return Math.max(
    characterSimilarity(normalizedA, normalizedB),
    tokenSimilarity(tokenize(a), tokenize(b))
  );
}
