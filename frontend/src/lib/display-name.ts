import type { Listing } from '@/types/data';

/**
 * Removes qualifiers from a Listing's raw title that ADR 0002 already
 * excludes from Canonical Fish *identity* (size/grade is a property of a
 * Listing's variants, not a separate identity dimension) but that were
 * still leaking into the *display* name verbatim (issue #91) — e.g.
 * "Giant Danio Size S", "Rummynose Tetra (Medium)". Two shapes are
 * stripped:
 *
 *   1. Any parenthetical aside, e.g. "(Medium)" or a parenthetical
 *      scientific name like "(Corydoras habrosus)" — the latter is
 *      redundant with the dedicated `scientificName` field this module's
 *      `getDisplayName` renders as its own subtitle, so dropping it here
 *      doesn't lose information, it just stops it from doubling up
 *      inline in the primary name.
 *   2. A trailing "Size <word(s)>" qualifier that isn't parenthesized,
 *      e.g. "Size S", "Size Large" — same size/grade exclusion, just a
 *      Store convention that skips the parens.
 *
 * Falls back to the original (trimmed) name if stripping would otherwise
 * leave nothing — a name that's *only* a qualifier is still better shown
 * as-is than blank.
 */
export function stripNameQualifiers(name: string): string {
  const stripped = name
    .replace(/\s*\([^()]*\)/g, ' ')
    .replace(/\s*\bsize\s+[a-z]+\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped || name.trim();
}

export interface DisplayName {
  /** Primary common name, with parenthetical/size qualifiers stripped. */
  name: string;
  /** Subtitle, rendered beneath `name` — never parenthesized. */
  scientificName: string | null;
}

/**
 * The single source of truth for how a Listing's name is shown to
 * shoppers (issue #91): common name as the primary name with qualifiers
 * stripped, scientific name (already a clean "Genus species" string, see
 * `scientific-name.ts`) as a separate subtitle — never parentheses
 * wrapping the scientific name inline. Both the home page's search
 * results (`ListingCard`) and the fish detail page (`FishDetailPage`)
 * call this instead of reading `commonName`/`scientificName` off a
 * Listing directly, so the two surfaces can't drift back apart the way
 * they had before this fix.
 */
export function getDisplayName(listing: Pick<Listing, 'commonName' | 'scientificName'>): DisplayName {
  return {
    name: stripNameQualifiers(listing.commonName),
    scientificName: listing.scientificName?.trim() || null,
  };
}
