---
status: accepted
---

# Raw archive stored as GitHub Release assets, not a git branch

Every Observation needs to be preserved indefinitely, in full, with no re-processing ever discarding the original. The initial proposal was a dedicated git branch for this archive. We rejected that: git repo performance degrades with file count and commit churn, not just total bytes — GitHub recommends keeping repos under ~5GB and clone/checkout operations slow sharply as object count grows, and daily Observations archived to a branch forever would compound that indefinitely. Instead, raw snapshots are uploaded as GitHub Release assets (one release per day, one combined gzip-compressed JSON asset covering every Store, keyed by store slug, plus a checksum for it) — assets sit outside git's object history entirely, so there's no clone/checkout penalty, while the archive still lives entirely on GitHub with no added cost or external service.

The aggregation step combines every Store's raw scraped data into this single JSON structure before compressing, rather than producing one gzip per Store (see issue #30). Each Store still scrapes and writes its own gzip independently during the per-Store matrix job — that per-Store file is only the intermediate working format; aggregation is what merges them into the day's one Release asset. Keeping one asset per day rather than N per Store means reprocessing a single Store's historical data requires decompressing and re-parsing the full day's combined blob (then discarding the other Stores' keys) instead of fetching just that Store's asset — an acceptable tradeoff at 15 Stores, revisit if Store count or archive size grows enough to make that wasteful.

**Considered options**: git branch (rejected — unbounded history growth degrades git performance over time), Git LFS (rejected — adds bandwidth/storage metering not needed yet), external object storage like Cloudflare R2/Backblaze B2 (rejected — adds a service when GitHub Releases already cover the need).
