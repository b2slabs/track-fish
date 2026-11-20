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
  },
  {
    name: 'Shrimpy Business',
    slug: 'shrimpy-business',
    domain: 'shrimpybusiness.com',
    platform: 'shopify'
  },
  {
    name: 'Flip Aquatics',
    slug: 'flip-aquatics',
    domain: 'flipaquatics.com',
    platform: 'shopify'
  },
  {
    name: 'AquariumFish.com',
    slug: 'aquarium-fish',
    domain: 'aquariumfish.com',
    platform: 'shopify'
  },
  {
    name: 'Imperial Tropicals',
    slug: 'imperial-tropicals',
    domain: 'imperialtropicals.com',
    platform: 'shopify'
  },
  {
    name: 'Daku Aquatics',
    slug: 'daku-aquatics',
    domain: 'dakuaquatics.com',
    platform: 'shopify'
  },
  {
    name: 'Buce Plant',
    slug: 'buce-plant',
    domain: 'buceplant.com',
    platform: 'shopify'
  },
  {
    name: 'Glass Aqua',
    slug: 'glass-aqua',
    domain: 'shop.glassaqua.com',
    platform: 'shopify'
  },
  {
    name: 'Global Exoticquatics',
    slug: 'global-exoticquatics',
    domain: 'globalexoticquatics.com',
    platform: 'shopify'
  },
  {
    name: 'AquaticsForFun',
    slug: 'aquatics-for-fun',
    domain: 'aquaticsforfun.com',
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

// Issue #14's second onboarding batch also checked (and rejected) two more
// candidates, both confirmed genuine Shopify stores with a working public
// /products.json, but whose catalogs fail the livestock check:
//
// - dustinsfishtanks.com: verified Shopify; sampled its entire 182-product
//   catalog (every page) on 2026-11-20 and found zero live fish, shrimp, or
//   snails for sale -- 100% aquarium plants, dry goods/equipment, and merch
//   (T-shirts referencing fish species in their name, but no fish). Despite
//   the store's name, its online storefront has evidently narrowed to
//   plants-only, same as Enchanted Grow in issue #4. Skipped.
// - aquariumcoop.com: verified Shopify; sampled its entire 325-product
//   catalog on 2026-11-20 and found zero livestock SKUs of any kind --
//   live plants, fish food, filtration/testing supplies, and merchandise
//   (including decals of fish species) only, no Fish/Shrimp/Snail product
//   category at all. Aquarium Co-Op is a real aquarium business but does
//   not ship livestock through this storefront (livestock is sold only at
//   their physical Washington State location), so there is no fish/
//   livestock catalog here to track. Skipped.
// - aquariumplantsfactory.com: verified Shopify; sampled its entire
//   722-product catalog (every page) on 2026-11-20 and found 716 of them
//   categorized as "Aquatic Plants", with the remaining handful being
//   accessories, a membership, and a gift card -- zero live fish, shrimp,
//   or snails for sale. The one title that superficially matched a fish
//   keyword ("Guppy Grass") is itself an aquatic plant, not a fish.
//   Plants-only catalog, same as Enchanted Grow in issue #4. Skipped.

export default stores;
