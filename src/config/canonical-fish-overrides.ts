/**
 * Manually-curated Canonical Fish resolutions (see issue #3).
 *
 * Automatic matching (scientific name, then fuzzy common-name — see
 * `src/lib/canonical-fish.ts`) deliberately does not auto-merge a Listing
 * whose best candidate match is ambiguous; instead it leaves the Listing
 * on its own trivial Canonical Fish id and records the candidate in the
 * `data` branch's `pending-matches.json` for a maintainer to look at (see
 * `processStoreRun`'s pending-matches bookkeeping). To resolve one, add an
 * entry here pointing that Listing at the Canonical Fish id it actually
 * belongs to (confirming or correcting the automatic suggestion) — this
 * takes priority over every automatic signal, including scientific name.
 *
 * Entries here are also the right place to fix a *wrong* automatic merge
 * (e.g. two genuinely different species that happened to share a
 * mis-extracted "scientific name" or a deceptively similar common name):
 * point the Listing back at its own trivial id, or at a different shared
 * id, as appropriate.
 */
export interface CanonicalFishOverride {
  /** The Listing this override applies to: `${storeSlug}:${productIdentifier}`. */
  listingId: string;
  /** The Canonical Fish id to force this Listing onto. */
  canonicalFishId: string;
  /** Why — for the next maintainer who finds this entry. */
  note?: string;
}

const overrides: CanonicalFishOverride[] = [
  {
    listingId: 'monster-aquarium:7008092487889',
    canonicalFishId: 'cf:sci:paracheirodon-axelrodi',
    note:
      'Monster Aquarium titles this Listing \'Albino Cardinal Tetra "Paracheirodon axelrodi"\' -- ' +
      'quotation marks around the scientific name instead of parentheses, which the extractor ' +
      'does not currently recognize (see src/lib/scientific-name.ts). It landed in ' +
      'pending-matches.json (fuzzy score 0.6) instead of auto-matching on first run. Per ADR 0002 ' +
      'an albino color morph is not a separate identity from the species, and Aquatic Arts lists ' +
      'the same species as "Cardinal Tetra (Paracheirodon axelrodi), Tank-Bred" -- confirmed by a ' +
      'maintainer as the same Canonical Fish.',
  },
];

export default overrides;
