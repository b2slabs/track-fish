/**
 * Bundle/combo product detection (issue #56, same-Store merge refinement).
 *
 * The same-Store merge (`canonical-fish.ts`'s `mergeVariants`/
 * `mergedListingId`, orchestrated in `process.ts`) assumes every Listing
 * sharing a Store and a `canonicalFishId` is a plain variant difference on
 * one underlying product -- a size, a potting style, tissue-culture vs.
 * rooted, sexed vs. unsexed, and so on. That assumption breaks for a
 * genuinely different *product type*: a "combo box" / "mix and match" /
 * "variety pack" / "choose your own" bundle is a separately-marketed
 * grab-bag product (often spanning several *different* color morphs or
 * species in one listing on purpose), not a pack-size variant of the base
 * species. Merging two bundles together, or a bundle into a plain Listing,
 * produces a nonsensical Listing whose variants are an arbitrary cross-
 * product of unrelated bundle configurations -- the real-world case that
 * surfaced this: Aquatic Arts's "Carbon Rili Shrimp Breeder Combo Box"
 * absorbing four *other* combo-box Listings for the same species (Wild
 * Form, Planted, and two different "Mix & Match ... Choose 2" products)
 * into one 187-variant Listing.
 *
 * This module is the gate: a Listing whose commonName matches this
 * heuristic is never folded into a same-Store merge group, regardless of
 * how many siblings share its `canonicalFishId` -- it always keeps its own
 * standalone `listingId`. A curated keyword/pattern list, in the same
 * spirit as `variety.ts`'s and `scientific-name.ts`'s heuristics: not
 * exhaustive, tuned to the real cases found in the dataset, extend it the
 * same way those modules' term lists get extended.
 */

const BUNDLE_PATTERNS: RegExp[] = [
  /\bcombo\b/i, // "Combo", "Combo Box", "Combo Pack(s)", "Combo Deal"
  /\bbundle\b/i,
  /\bmix\s*&\s*match\b/i, // "Mix & Match"
  /\bmix\s*\+\s*match\b/i, // "Mix + Match"
  /\bmix\s+and\s+match\b/i,
  /\bvariety\s+pack\b/i,
  /\bvariety\s+box\b/i,
  /\bchoose\s+your\b/i, // "Choose Your Betta", "Choose Your Worms"
  /\bchoose\s+\d/i, // "Choose 2"
  /\bpick\s+your\b/i,
  /\bpick\s+\d/i, // "Pick 2"
  /\bbuild\s+your\s+own\b/i,
];

/**
 * Whether a Listing's commonName reads as a bundle/combo/variety-pack
 * product rather than a plain variant of the base species/product -- see
 * the module doc. Scans only the common name (title), the same scoping
 * choice `variety.ts` makes: these phrases are reliably marketing copy in
 * the title across every real case found, not body text worth mining.
 */
export function isBundleListing(commonName: string): boolean {
  return BUNDLE_PATTERNS.some((pattern) => pattern.test(commonName));
}
