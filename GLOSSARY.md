# Track Fish

Tracks fish products sold by online aquarium stores — prices, availability, and historical changes — across multiple store platforms, so a shopper can compare the same fish across stores over time.

## Language

**Store**:
An online retailer whose product catalog is tracked (e.g. a Shopify-based aquarium shop).
_Avoid_: Shop, vendor, retailer, site.

**Listing**:
A single product entry as it appears on one Store — tied to that store's own product identifier, name, price, and variants. The same fish may have a different Listing on every Store that sells it.
_Avoid_: Product, item, SKU.

**Canonical Fish**:
The cross-store identity that groups together every Listing believed to represent the same species and variety/color-morph, enabling price comparison across Stores. Two Listings of the same species but a different named variety (e.g. "Albino Cory" vs "Bronze Cory") are different Canonical Fish; size/count/sourcing wording ("School of 6", "Tank-Bred") is not part of identity (see `docs/adr/0004-variety-is-part-of-canonical-fish-identity.md`).
_Avoid_: Species, product group, fish record.

**Scrape Run**:
One execution of the scraper against a Store, producing a raw snapshot of that Store's catalog at a point in time.
_Avoid_: Scrape, crawl, job.

**Observation**:
The raw, unprocessed snapshot of a Listing captured during a Scrape Run, archived in full regardless of whether anything changed since the previous Scrape Run.
_Avoid_: Snapshot, raw record.

**Change Event**:
A processed-layer record created only when a Listing's price or availability differs from its previously known state.
_Avoid_: Update, delta, diff.

**lastCheckedAt**:
A timestamp on a Listing's processed-layer metadata, updated in place on every Scrape Run that observes it — whether or not anything changed — confirming it was still observed as of that date. Replaces the old "Heartbeat" record-per-unchanged-observation model (see `docs/adr/0005-heartbeat-events-replaced-by-lastcheckedat.md`): it is a single pointer, not an append-only event.
_Avoid_: Heartbeat, ping, keep-alive, unchanged record.
