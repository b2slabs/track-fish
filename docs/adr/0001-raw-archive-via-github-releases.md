---
status: accepted
---

# Raw archive stored as GitHub Release assets, not a git branch

Every Observation needs to be preserved indefinitely, in full, with no re-processing ever discarding the original. The initial proposal was a dedicated git branch for this archive. We rejected that: git repo performance degrades with file count and commit churn, not just total bytes — GitHub recommends keeping repos under ~5GB and clone/checkout operations slow sharply as object count grows, and daily Observations archived to a branch forever would compound that indefinitely. Instead, raw snapshots are uploaded as GitHub Release assets (one release per day, one asset per Store) — assets sit outside git's object history entirely, so there's no clone/checkout penalty, while the archive still lives entirely on GitHub with no added cost or external service.

**Considered options**: git branch (rejected — unbounded history growth degrades git performance over time), Git LFS (rejected — adds bandwidth/storage metering not needed yet), external object storage like Cloudflare R2/Backblaze B2 (rejected — adds a service when GitHub Releases already cover the need).
