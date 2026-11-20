---
status: accepted
---

# Canonical Fish identity is species-level, not size-aware

The same species sold at different sizes/grades legitimately carries different prices, so we considered splitting Canonical Fish identity by size as well as species (e.g. "Betta Splendens, Small" and "Betta Splendens, Large" as separate identities) to keep price comparisons apples-to-apples. We decided against it: a Canonical Fish groups Listings at the species level only, with size/grade carried as a property of each Listing's variants rather than as a separate identity dimension. Splitting identity by size would require normalizing store-specific size/grade vocabulary (which varies per store, unlike scientific names) just to establish identity, compounding an already-hard cross-store matching problem. The frontend is responsible for surfacing size next to price so a comparison isn't misread as apples-to-apples when it isn't.

**Considered options**: size-aware Canonical Fish, one identity per species+size (rejected — multiplies the identity-matching problem with a second, messier normalization axis before any comparison value is realized).
