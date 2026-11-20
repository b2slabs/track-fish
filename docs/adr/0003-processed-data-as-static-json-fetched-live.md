---
status: accepted
---

# Processed data as static JSON on a dedicated branch, fetched live by the frontend

The processed layer needs to support browse/search/filter/sort across all Listings and per-Canonical-Fish history charts, while staying inside a "personal tool, hosted entirely on GitHub, no backend" constraint. We decided to store it as flat JSON on a dedicated `data` git branch (separate from `main`) — one `index.json` covering every current Listing, plus one history file per Canonical Fish fetched only when its detail view is opened — rather than a database. The React/shadcn frontend, once deployed to GitHub Pages, fetches these files live at runtime rather than having data baked in at build time. This fully decouples the daily scrape workflow from frontend deployment: a scrape run only ever commits to `data`; the Pages site never needs to rebuild or redeploy in response.

**Considered options**: SQLite committed to the repo (rejected — GitHub Pages has no server to execute SQL against, and client-side would need sql.js/wasm, heavier than fetching JSON at this data's size); baking data into the frontend at build time (rejected — couples scrape cadence to a deploy pipeline for no benefit, since live fetch costs nothing extra at this scale).
