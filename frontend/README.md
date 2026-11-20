# Track Fish — browse dashboard

React + [shadcn/ui](https://ui.shadcn.com) (Radix style, Vite template) browse/detail
dashboard, deployed to GitHub Pages at <https://b2slabs.github.io/track-fish/>.

See `docs/PRD.md` (Frontend section) and `docs/adr/0003-processed-data-as-static-json-fetched-live.md`
at the repo root for the design this implements.

## What it does

- Fetches `index.json` **live, at runtime**, directly from
  `https://raw.githubusercontent.com/b2slabs/track-fish/data/index.json` — never baked in
  at build time, so the deployed site reflects the latest scrape run without a redeploy.
- Browse all tracked Listings: search by name, filter by store and availability, sort by
  price.
- A per-fish detail page (`/#/fish/<canonicalFishId>`) fetches that Canonical Fish's
  history file live (`fish/<safe-id>.json` on the `data` branch) and renders a
  price/availability chart.
- Every Listing links to its original store product page and uses that store's own
  hotlinked image URL — nothing is mirrored.
- Shows when the underlying data (`index.json`'s `generatedAt`, plus per-store
  `lastSuccessfulRunAt`) was last updated.

Data fetching lives in `src/lib/data-source.ts`; the Canonical-Fish-id → filename mapping
there mirrors `historyFilePath` in `src/lib/data-branch.ts` on `main`.

## Develop

```sh
npm install
npm run dev
```

## Build / preview

```sh
npm run build
npm run preview
```

`vite.config.ts` sets `base: '/track-fish/'` to match the GitHub Pages project-page URL,
and the app uses a `HashRouter` so client-side routes (e.g. `/fish/:id`) work without any
server-side rewrite rules.

## Deploy

`.github/workflows/deploy-pages.yml` builds this app and publishes it via GitHub's native
Pages Actions deployment on every push to `main` that touches `frontend/`. The scrape
pipeline (which only ever commits to the `data` branch) never triggers this workflow, and
this workflow never touches `data` — see ADR 0003.
