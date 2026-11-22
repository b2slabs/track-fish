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
  },
  {
    name: 'NU Aqua Shop',
    slug: 'nu-aqua-shop',
    domain: 'nuaquashop.com',
    platform: 'shopify'
  },
  {
    name: "Dan's Fish",
    slug: 'dans-fish',
    domain: 'dansfish.com',
    platform: 'shopify'
  },
  {
    // Issue #80: first non-Shopify platform onboarded -- confirmed
    // WooCommerce (WordPress) via curl, not Shopify. Verified the public
    // WooCommerce Store API (`/wp-json/wc/store/v1/products`) works and
    // sampled the entire 3911-product catalog on 2026-11-22: 3691
    // products (94%) are under the "LIVESTOCK" category, broken into
    // per-family subcategories (South American/Lake Malawi/Tanganyika
    // cichlids, tetras, livebearers, plecos, corydoras, loaches, etc.) --
    // a genuine, large fish/livestock catalog, not just plants/
    // equipment/merch (which also exist here, same as several Shopify
    // Stores already onboarded, but are a small minority).
    //
    // Domain is the `www` subdomain directly: the bare domain 301-
    // redirects to it, and the Store API additionally 403s every request
    // under `wc/store/v1` (even a real browser's own `/cart` AJAX calls)
    // unless it carries a same-origin `Referer` header -- see
    // `WooCommerceStoreAdapter`'s doc comment. Confirmed this isn't a
    // bot-detection/JS challenge (no cookies or challenge token needed,
    // holds up across User-Agents, and every *other* wp-json namespace
    // on this Store is unprotected) -- it's a WAF rule specific to this
    // one path on this one Store.
    name: 'The Wet Spot Tropical Fish',
    slug: 'wet-spot-tropical-fish',
    domain: 'www.wetspottropicalfish.com',
    platform: 'woocommerce'
  },
  {
    // Issue #80, alongside Wet Spot above: confirmed WooCommerce, public
    // Store API works with no special headers needed. Sampled the
    // entire 2424-product catalog on 2026-11-22: 1761 under "Freshwater
    // Fish" and 222 under "Saltwater Fish" (plus herps, invertebrates,
    // corals), well over half the catalog -- a genuine livestock
    // wholesaler, not just plants/equipment/merch.
    //
    // Domain is the `www` subdomain directly: the bare domain 301-
    // redirects to it over plain HTTP, so using `www` avoids that extra
    // hop/scheme downgrade.
    name: 'Aqua Imports',
    slug: 'aqua-imports',
    domain: 'www.aqua-imports.com',
    platform: 'woocommerce'
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
