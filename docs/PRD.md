# Track Fish — PRD

## Problem

Online aquarium stores change fish prices and stock constantly, and there's no way to see that history or compare the same fish across stores. This project periodically collects product data from aquarium stores and keeps a historical record of prices and availability, so fish can be compared across stores over time.

## Audience

A personal tool, hosted entirely on GitHub (Actions + Releases + Pages). Not a public product in v1 — architecture should stay conservative where that's cheap, but no effort is spent on multi-tenant concerns, auth, or scaling beyond a handful of stores.

## Goals (v1)

- Track fish products sold by a fixed set of Shopify-based aquarium stores.
- Preserve every raw scrape response indefinitely, independent of how it's later processed.
- Normalize raw data into price/availability history per fish, comparable across stores.
- Serve a simple React dashboard (browse, search, filter, sort, compare, per-fish history charts) from GitHub Pages.
- Run unattended: a daily scheduled job with no manual steps required.

## Non-goals (v1)

- Non-Shopify store support (the adapter interface must allow it later; no second adapter is built now).
- A "Delisted" signal when a product disappears from a store's catalog — out of scope; a vanished Listing simply stops updating.
- Deduplicating raw archive snapshots — every Scrape Run archives a full snapshot regardless of whether anything changed.
- Any backend/database/server — the frontend is a static site with no API of its own.
- robots.txt enforcement — Shopify's default robots.txt already allows the endpoints used, so this isn't a gap in practice.
- Custom failure alerting — GitHub Actions' built-in email on scheduled-run failure is the only notification mechanism.

## Domain language

See `GLOSSARY.md` for precise definitions of **Store**, **Listing**, **Canonical Fish**, **Scrape Run**, **Observation**, **Change Event**, and **lastCheckedAt**. Key points:

- A **Canonical Fish** is species-level — size/grade is a property of a **Listing**'s variants, not a separate identity (see [ADR 0002](./adr/0002-canonical-fish-is-species-level.md)). The UI must show size next to price so cross-store comparisons aren't misleading.
- Fish identity across stores is established by a hybrid match: automatic by scientific name (when present) plus fuzzy common-name matching, falling back to a manually-curated mapping for ambiguous cases.
- The processed layer is sparse by design: a **Change Event** is written only when a Listing's price or availability changes. An unchanged observation advances that Listing's **lastCheckedAt** pointer in place instead of writing anything to the event history (see [ADR 0005](./adr/0005-heartbeat-events-replaced-by-lastcheckedat.md)). It is not one row per scrape.

## Initial stores

- aquaticarts.com
- monsteraquariumon9.com
- ckfishworld.com
- aquahuna.com
- nationwideaquaticsusa.com
- enchantedgrow.com

New stores are added via config, not a redesign.

## Architecture

### Scraping

- One adapter per platform (`StoreAdapter`-shaped interface); only a Shopify implementation exists in v1.
- Pulls each store's public `/products.json` / `/collections/<handle>/products.json` endpoints — no login, no bypass of any access control.
- Custom `User-Agent` + ~1 request/second per store, purely to avoid tripping bot-detection and getting the scraper's IP blocked. robots.txt is not consulted (moot for the endpoints in use).
- A Scrape Run's output is rejected outright — not committed, not treated as data — if its parsed Listing count drops more than ~50% versus the Store's last successful run. This is the primary defense against silently corrupting history when a store's site structure changes under us.

### Raw archive

- See [ADR 0001](./adr/0001-raw-archive-via-github-releases.md): archived as GitHub Release assets, not a git branch.
- One Release per day (tagged by date), one combined gzip-compressed JSON asset covering every Store (keyed by store slug), plus a manifest with its SHA-256 checksum for integrity verification.
- No deduplication — every Store's Observation is archived in full every Scrape Run.

### Processing & storage

- See [ADR 0003](./adr/0003-processed-data-as-static-json-fetched-live.md): a dedicated `data` git branch (separate from `main`) holds the processed layer: current Listings plus the Change Event history, as flat JSON files — no SQLite, no external database.
- Shaped as one lightweight `index.json` (every current Listing, for browse/search/filter/sort) plus one history file per Canonical Fish (fetched only when its detail/chart view is opened).
- This layer stays small by construction — it only grows on actual price/availability changes, not on every scrape — so it tolerates living in git indefinitely. See [ADR 0005](./adr/0005-heartbeat-events-replaced-by-lastcheckedat.md): an unchanged observation advances a single `lastCheckedAt` pointer per Listing in place rather than appending anything to the event history.

### Automation

- One daily GitHub Actions workflow (cadence configurable), with a matrix job per Store scraping in parallel, feeding into a single aggregation step that makes one commit to `data` and one Release. This avoids two scheduled runs racing to commit to the same branch.
- Failures surface via GitHub's default email on a failed scheduled run; no custom alerting.

### Frontend

- React + shadcn/ui, deployed to GitHub Pages.
- Fetches `index.json` and per-Canonical-Fish history files **live, at runtime**, directly from the `data` branch (see [ADR 0003](./adr/0003-processed-data-as-static-json-fetched-live.md)) — the site is never rebuilt or redeployed as a side effect of a scrape run. Scraping and frontend deployment are fully decoupled.
- Images are hotlinked directly from each Store's own URLs — not mirrored into the archive.

## Open questions for later

- Revisit raw dedup if archive storage actually becomes a problem (GitHub Releases have no documented total-size ceiling, so this is not expected soon).
- Revisit a "Delisted" signal if staleness on vanished Listings turns out to matter in practice.
- Shopify's public JSON endpoints cap at 25,000 items (`page × limit`) per store; none of the six initial stores are expected to approach that, but it's a ceiling to know about before adding a very large store.
