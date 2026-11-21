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
    canonicalFishId: 'cf:sci:paracheirodon-axelrodi:albino',
    note:
      'Monster Aquarium titles this Listing \'Albino Cardinal Tetra "Paracheirodon axelrodi"\' -- ' +
      'quotation marks around the scientific name instead of parentheses, which the extractor ' +
      'does not currently recognize (see src/lib/scientific-name.ts). It landed in ' +
      'pending-matches.json (fuzzy score 0.6) instead of auto-matching on first run. Originally ' +
      'pointed at the bare cf:sci:paracheirodon-axelrodi id on the strength of ADR 0002 ' +
      '("an albino color morph is not a separate identity from the species") -- that ADR was ' +
      'amended by issue #34, which made variety/color-morph part of Canonical Fish identity ' +
      'specifically because merges like this one (an albino morph folded into the plain species) ' +
      'were incorrectly conflating separately-marketed products. Repointed to the ' +
      '":albino"-suffixed id so this Listing lands on the same id automatic matching now gives ' +
      'every other "Albino Cardinal Tetra" Listing, instead of merging with plain, non-albino ' +
      '"Cardinal Tetra (Paracheirodon axelrodi), Tank-Bred" Listings (e.g. Aquatic Arts\'s).',
  },
  {
    listingId: 'aquahuna:4738582609995',
    canonicalFishId: 'cf:sci:corydoras-aeneus:albino',
    note:
      'Before issue #16\'s fix, a case-insensitivity bug in the "Scientific Name:" label matcher ' +
      '(see scientific-name.ts) let several Stores\' mis-capitalized or run-on descriptions ' +
      '(e.g. "...Corydoras Aeneus From our tank...") get corrupted into their own ' +
      'cf:sci:corydoras-aeneus-from id, splitting them from the correct cf:sci:corydoras-aeneus ' +
      'group. The extraction bug itself is fixed, and on reprocessing every other affected ' +
      'Listing self-corrects back via its own clean re-extraction or a confident fuzzy match. This ' +
      'Listing is the one exception: its title ("Albino Cory") and description extract no ' +
      'scientific name of their own at all, so it depends purely on fuzzy common-name matching, ' +
      'and a same-scoring tie between the (shrinking) legacy "-from" group and the correct group ' +
      'does not reliably resolve to the correct one depending on processing order. Originally ' +
      'pointed at the bare cf:sci:corydoras-aeneus id; repointed to the ":albino"-suffixed id by ' +
      'issue #34 (variety is now part of Canonical Fish identity), which also split the bare id ' +
      'away from "Bronze Cory" and "Orange Venezuelan Cory" -- other color morphs of the same ' +
      'species that this override must not drag the Albino morph back into. Still the same ' +
      'species/variety (Corydoras aeneus, albino) as every other plain "Albino Cory"/"Albino ' +
      'Cory (Corydoras aeneus)" Listing across stores -- note "Albino HiFin Cory" is a distinct, ' +
      'further-specialized variety signature ({albino, hifin} vs {albino}) and correctly lands ' +
      'on its own id, not this one.',
  },
  ...(['aquahuna:7456012402763', 'aquarium-fish:10359234167083', 'aquarium-fish:1592179064902',
       'aquatic-arts:11385997708', 'monster-aquarium:7466867392721', 'nu-aqua-shop:10006318842172',
       'shrimpy-business:9470968693026'] as const).map((listingId) => ({
    listingId,
    canonicalFishId: 'cf:sci:boraras-merah',
    note:
      'Regression check for issue #3\'s cross-store "Boraras merah" merge, caught while verifying ' +
      'issue #16: a prior pipeline run (before issue #16\'s canonical-fish.ts guard existed -- see ' +
      'its module doc) let a mis-extracted "cf:sci:boraras-merah-we" id (same label-matching bug ' +
      'as the Corydoras aeneus case above, on a different Store\'s "Phoenix Rasbora" description) ' +
      'win a fuzzy-score tie against every other Store\'s clean "Boraras merah" extraction, ' +
      'including title-parenthetical ones that should never have been touched. That run fully ' +
      'emptied the correct cf:sci:boraras-merah group of cross-store members and got committed to ' +
      'the data branch, so issue #16\'s guard (which protects an *already-established* clean group ' +
      'from being hijacked) has nothing left to protect -- there is no longer a clean anchor for it ' +
      'to defer to. These overrides are the one-time remediation: repoint every Listing the earlier ' +
      'bad run mis-grouped back to the correct, canonical cf:sci:boraras-merah.',
  })),
];

export default overrides;
