/**
 * Classifies a Listing into a coarse browse/search ranking tier: fish (or
 * other livestock), plant, or everything else — accessories, equipment,
 * supplies, customization fees, water, tubing, food, and the like (issue
 * #54).
 *
 * Why this exists: the browse page's default sort (issue #45/#46) ranks
 * in-stock-first, then by price, with no awareness of what's actually
 * being sold. Junk/accessory Listings are frequently both in stock and
 * priced near zero ("Item Customizations" $0.01, "Reverse Osmosis Water"
 * $0.50, "Used Airline - Per Foot" $0.50), so they floated to the top of
 * the grid ahead of genuine fish. This module adds a category as the
 * PRIMARY sort key, ahead of availability/price, which still break ties
 * within a tier.
 *
 * This is a keyword/pattern heuristic over `commonName`/`description`
 * free text, in the same documented-limitations spirit as
 * `scientific-name.ts` and `variety.ts` on the backend — not a real
 * product taxonomy, and deliberately not exhaustive. Known limitations:
 *
 *   - Precedence is OTHER > PLANT > FISH (see `categorizeListing` below).
 *     An accessory/equipment keyword always wins over a livestock or
 *     plant keyword appearing in the same text, because real-world
 *     accessory titles are routinely themed around a species they are
 *     NOT ("Betta Heater", "Shrimp Food", "Amazon Sword Plant
 *     Fertilizer") — the product noun (heater/food/fertilizer) is the
 *     reliable signal there, not the themed species name. The cost is
 *     the reverse case: a genuine live animal/plant whose title happens
 *     to also contain an OTHER keyword (e.g. a decor item literally
 *     named after a fish, "Betta Log Hide") will be under-ranked as
 *     OTHER. That's an accepted trade-off, not a bug.
 *   - Keyword lists are curated, not generated from any taxonomy. Many
 *     genuine species/plant names are simply not covered and will fall
 *     through to OTHER by default. Extend the lists below as new
 *     real-world misses surface, the same way `VARIETY_TERMS` grows in
 *     `variety.ts`.
 *   - Generic terms ("fish", "shrimp", "snail") are included in the
 *     livestock list to catch Listings with no specific species name
 *     (e.g. "Assorted Feeder Fish"). This trades a small amount of
 *     precision for recall — it's safe in practice only because the
 *     OTHER-keyword check runs first and catches most non-livestock
 *     "fish-adjacent" product nouns (food, tanks, nets, bowls, ...).
 *   - `commonName` (the title) is checked first; `description` is only
 *     consulted as a fallback when the title alone matches nothing at
 *     all. Store descriptions routinely carry boilerplate disclaimers
 *     ("Domestic shipping only!", "100% live arrival guarantee", "DOA
 *     refunds...") on literally every Listing regardless of what's being
 *     sold, so always scanning the full description would make common
 *     OTHER-ish words in that boilerplate (e.g. "shipping", "guarantee")
 *     dominate real fish/plant titles. Titles reliably carry the actual
 *     product identity — the three reported junk examples and every
 *     genuine fish/plant Listing checked while building this heuristic
 *     have the deciding keyword in the title — so description is only
 *     given a chance when the title is silent. Same false-positive
 *     lesson `variety.ts` already applies by scanning only the title.
 *   - No image inspection, no price-based signals, no store-category
 *     metadata (Shopify's public `/products.json` doesn't reliably
 *     expose one across stores anyway).
 */

export type ListingCategory = 'fish' | 'plant' | 'other';

// Product nouns that reliably signal "not a living thing for sale" —
// equipment, supplies, consumables, fees, and services. Checked first
// (see module doc): these win over any livestock/plant keyword also
// present in the same text.
const OTHER_KEYWORDS = [
  // Fees / non-product line items
  'customization', 'customizations', 'gift card', 'store credit',
  'shipping', 'warranty', 'membership', 'subscription', 'donation',
  'deposit', 'surcharge', 'service fee', 'restocking fee',

  // Water / chemistry
  'reverse osmosis', 'ro water', 'water conditioner',
  'dechlorinator', 'water treatment', 'aquarium salt', 'marine salt',
  'sea salt', 'fertilizer', 'co2', 'ph up', 'ph down', 'ph buffer',
  'medication', 'dewormer', 'parasite treatment',

  // Tubing / plumbing / hardware
  'airline', 'air line', 'air pump', 'air stone', 'tubing', 'bulkhead',
  'check valve', 'drip line', 'python', 'siphon',

  // Equipment
  'filter media', 'filter cartridge', 'filter sponge', 'canister filter',
  'hob filter', 'sponge filter', 'protein skimmer', 'skimmer',
  'powerhead', 'wavemaker', 'return pump', 'heater', 'thermometer',
  'chiller', 'uv sterilizer', 'uv light', 'led light', 'light fixture',
  'light bulb', 'timer', 'controller', 'auto feeder', 'doser', 'dosing',
  'quarantine tank', 'sump', 'hydrometer', 'refractometer',

  // Supplies / decor / consumables
  'substrate', 'gravel', 'sand', 'decor', 'ornament', 'background',
  'test kit', 'test strip', 'net', 'scraper', 'magnet cleaner',
  'algae pad', 'aquarium stand', 'tank stand', 'tank lid', 'tank cover',
  'sealant', 'silicone', 'glue', 'breeding cave', 'spawning cave',
  'hide', 'botanicals', 'replacement', 'kit',

  // Food / supplements
  'food', 'pellet', 'pellets', 'flake', 'flakes', 'frozen cube',
  'freeze dried', 'wafer', 'wafers', 'vitamin', 'supplement', 'nutrition',

  // Merchandise/apparel (stores occasionally sell branded swag alongside
  // livestock/plants)
  't-shirt', 'tee', 'hoodie', 'sticker', 'apparel', 'keychain', 'mug',
];

// Aquatic plant names and plant-specific product nouns.
const PLANT_KEYWORDS = [
  'plant', 'plants', 'java fern', 'anubias', 'cryptocoryne', 'crypt',
  'vallisneria', 'amazon sword', 'sword plant', 'sword', 'echinodorus',
  'java moss', 'moss ball', 'moss', 'marimo', 'hornwort', 'cabomba',
  'bacopa', 'rotala', 'ludwigia', 'hygrophila', 'water wisteria',
  'duckweed', 'frogbit', 'salvinia', 'pogostemon', 'staurogyne',
  'hairgrass', 'bucephalandra', 'buce', 'water lettuce',
  'red root floater', 'water sprite', 'ambulia', 'dwarf lily',
  'tiger lotus', 'banana plant', 'moneywort', 'pennywort',
  'water clover', 'mermaid weed', 'tissue culture', 'ammannia',
  'lindernia', 'crinum', 'heteranthera', 'lagenandra', 'limnophila',
  'juncus', 'nymphoides', 'syngonium',
];

// Common names of livestock sold through these stores: ornamental fish,
// aquarium invertebrates, and the generic nouns used when a Listing has
// no specific species name.
const FISH_KEYWORDS = [
  'fish', 'tetra', 'barb', 'danio', 'rasbora', 'cory', 'corydoras',
  'corydora', 'pleco', 'bushynose', 'bristlenose', 'catfish', 'loach',
  'cichlid', 'oscar', 'discus', 'angelfish', 'betta', 'gourami',
  'killifish', 'livebearer', 'molly', 'mollies', 'platy', 'platys',
  'guppy', 'swordtail', 'goldfish', 'oranda', 'koi', 'shark', 'ray',
  'eel', 'goby', 'tang', 'clownfish', 'damsel', 'wrasse', 'puffer',
  'arowana', 'flowerhorn', 'parrotfish', 'severum', 'jack dempsey',
  'convict', 'glassfish', 'bichir', 'knifefish', 'hatchetfish',
  'pencilfish', 'rainbowfish', 'chromide', 'shiner', 'datnoid',
  'apistogramma', 'acara', 'shrimp', 'snail', 'crayfish', 'crab',
  'lobster', 'clam', 'mussel', 'coral', 'anemone', 'starfish', 'urchin',
  'isopod', 'isopods', 'nerite', 'mystery snail', 'assassin snail',
];

/**
 * Normalizes text to a space-padded, space-collapsed lowercase string so
 * keyword membership can be checked with simple substring search while
 * still respecting word boundaries (padding + the keyword's own
 * surrounding spaces prevent e.g. "ray" from matching inside "array").
 */
function normalize(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
}

function containsAny(normalizedHaystack: string, needles: string[]): boolean {
  return needles.some((needle) => normalizedHaystack.includes(` ${needle} `));
}

/** Checks one normalized text against all three keyword lists, in OTHER
 * > PLANT > FISH precedence (see module doc). Returns null if nothing
 * matched, so the caller can decide what to fall back to. */
function classify(normalizedText: string): ListingCategory | null {
  if (containsAny(normalizedText, OTHER_KEYWORDS)) {
    return 'other';
  }
  if (containsAny(normalizedText, PLANT_KEYWORDS)) {
    return 'plant';
  }
  if (containsAny(normalizedText, FISH_KEYWORDS)) {
    return 'fish';
  }
  return null;
}

/**
 * Classifies a Listing's category tier. Checks `commonName` (the title)
 * first; only consults `description` when the title matches nothing at
 * all (see module doc for why description isn't scanned unconditionally).
 * Always returns a tier — falls back to `'other'` when neither field
 * matches anything, since an unrecognized product is more likely to be a
 * miscellaneous accessory than a genuine, unlabeled fish or plant.
 */
export function categorizeListing(listing: { commonName: string; description: string }): ListingCategory {
  const fromTitle = classify(normalize(listing.commonName));
  if (fromTitle) {
    return fromTitle;
  }
  return classify(normalize(listing.description)) ?? 'other';
}

// Lower rank sorts first. fish (0) < plant (1) < other (2).
const CATEGORY_RANK: Record<ListingCategory, number> = {
  fish: 0,
  plant: 1,
  other: 2,
};

/** Sort-key rank for a category tier: fish above plant above other. */
export function categoryRank(category: ListingCategory): number {
  return CATEGORY_RANK[category];
}
