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
The cross-store identity that groups together every Listing believed to represent the same species, enabling price comparison across Stores.
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

**Heartbeat**:
A periodic processed-layer record confirming a Listing was observed with no change since its last Change Event.
_Avoid_: Ping, keep-alive, unchanged record.
