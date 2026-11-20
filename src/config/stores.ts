const stores = [
  {
    name: 'Aquatic Arts',
    slug: 'aquatic-arts',
    domain: 'aquaticarts.com',
    platform: 'shopify'
  },
  {
    name: 'Monster Aquarium',
    slug: 'monster-aquarium',
    domain: 'monsteraquariumon9.com',
    platform: 'shopify'
  },
  {
    name: 'AquaHuna',
    slug: 'aquahuna',
    domain: 'aquahuna.com',
    platform: 'shopify'
  },
  {
    name: 'CK Fish World',
    slug: 'ck-fish-world',
    domain: 'ckfishworld.com',
    platform: 'shopify'
  },
  {
    name: 'Nationwide Aquatics USA',
    slug: 'nationwide-aquatics-usa',
    domain: 'nationwideaquaticsusa.com',
    platform: 'shopify'
  }
];

// Enchanted Grow (enchantedgrow.com) from the PRD's initial store list was
// NOT added here: it is confirmed Shopify with a public /products.json
// (verified via curl with this scraper's User-Agent), but as of 2026-11-20
// its live catalog is exclusively houseplants and carnivorous plants
// (Nepenthes, Butterwort, snake plants, ferns, succulents, etc.) -- zero
// fish/aquarium livestock across 500 sampled products, just a handful of
// aquarium *plants* (e.g. Amazon Frogbit) incidentally mentioning
// "aquariums". The domain has evidently been repurposed away from being an
// aquarium store since the PRD was written. Onboarding it as-is would run
// the matching/canonical-fish logic over an unrelated plant catalog and
// pollute the data layer, so per issue #4's guidance it is skipped rather
// than forced in. Revisit if enchantedgrow.com starts selling fish again.

export default stores;
