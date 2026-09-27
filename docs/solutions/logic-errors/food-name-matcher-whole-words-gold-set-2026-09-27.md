---
title: "Food-name matching by substring picks the wrong food (\"watermelon\" → spicy stew, \"almonds, raw\" → strawberry guava) — match whole words, and measure any matcher change right/wrong/none in every caller's query shape"
track: bug
category: logic-errors
tags: [architecture, testing, nutrition, matching, measurement, caching]
module: server
applies_to: [server/services/nutrition-lookup.ts, server/services/cultural-food-map.ts]
symptoms: ["A common food resolves to an unrelated one whose name merely contains it or one of its words — \"butter\" → butterfish, \"banana\" → banana pepper, \"egg\" → egg bagel", "A cultural-dish alias rewrites ordinary foods before any database search — \"watermelon\"/\"coconut water\" → \"spicy stew\" (alias \"wat\"), \"papaya\" → \"cassava porridge\" (\"pap\")", "The wrong result is cached under the query key for every user for the 7-day TTL"]
created: 2026-09-27
last_updated: 2026-09-27
severity: high
---

# Food-name matching by substring picks the wrong food — match whole words, and measure any matcher change right/wrong/none in every caller's query shape

## Problem

Two matchers in the nutrition lookup chain (PR #1120):

- **`lookupCulturalFood`** (`server/services/cultural-food-map.ts`) tested `normalized.includes(alias)` and then replaced the **whole query** with the dish's name. Short aliases matched inside ordinary words: `"wat"` in water/watermelon (176 of 5,690 CNF foods), `"pap"` in papaya/paprika, `"roti"` in rotisserie, `"pho"` in phosphate, `"chole"` in cholesterol, `"lassi"` in classic.
- **`scoreCNFMatch`** (`server/services/nutrition-lookup.ts`) used `d.includes(word)` ("raw" inside "st**raw**berry", "butter" inside "butterfish"). Worse, it ranked a query found in a *qualifier* above the food itself, on the stated premise that "parts[1+] are the actual food name". That's false for CNF whole foods, whose first comma-part IS the food ("Egg, chicken, whole", "Banana, raw").

On a 51-query labeled gold set against the real CNF list, the old scorer found the right food 12 times, a wrong food 37 times, and no match twice.

## Symptoms

See frontmatter. The tell is a match whose description contains the query as a fragment or a qualifier rather than as its head.

## Root Cause

Substring containment is not word matching, and a ranking rule was written from the CNF rows that begin with a category ("Grains, rice, …") while the food-headed rows ("Banana, raw") were the majority for single-food queries.

## Solution

- **Cultural aliases:** one precompiled whole-word pattern per alias, `(?<![\p{L}\p{N}])<escaped alias>(?:e?s)?(?![\p{L}\p{N}])`, with the `u` flag. The optional plural ending is required: the substring test matched "2 tacos"/"rotis" by accident, and whole-word matching without it silently dropped them (found in review).
- **CNF scorer:** whole-word matching with singular/plural variants; the query tokenized like the description; **every query word must match** (a partial match returns 0 → USDA fallback); the head comma-part competes, and a part that *is* the query outranks one that only starts with it. Result: right 41, wrong 6, no match 4.
- **Quantities in the query:** callers still send "1 cup rice". Strip only a **leading run that starts with a number** ("1 cup", "2 large", "12oz", "1/2 cup"). A first attempt dropped unit words *anywhere* and regressed food names that contain one: "Reese's Pieces", "green gram", "small white beans", "cup noodles" all flipped from right to wrong (found in review).

## Prevention

**Measure a matcher change, don't reason about it.** What caught every defect here was a labeled measurement, and what nearly shipped two regressions was a missing axis:

1. **Label a gold set with the right answer**, not just the input. Grep the real list for the correct row's spelling first (CNF writes "Yogourt", "Orange juice, raw", "Nuts, almonds, …").
2. **Score three outcomes: right / wrong / no match.** Counting only "did it match" is misleading in both directions. One review counted 160 queries "regressed" from match to no-match; most of those old matches were wrong foods (rice → rice cakes, peanut butter → a cookie).
3. **Run it in every caller's query shape**, not just bare names: `"2 <name>"` (photos), `"1 cup <name>"`/`"3 oz <name>"` (cooking), `"12oz <name>"` (beverages), `"1/2 cup <name>"`. The coverage gate disabled CNF for every quantity-shaped caller while the bare-name gold set looked perfect.
4. **Sweep the collision axis of any stoplist**: every real name that contains a stripped word must still resolve to its own row (all 18 multi-word CNF names containing a unit word).
5. **Generate a sweep from the list's own structure**, beside the hand-labeled gold set. The gold set carries the cases you already thought of. For the dehydrated-form tie-break (#1126, below) the gold set improved 41/6/4 → 43/4/4, while two review sweeps generated from CNF rows found regressions it could not see:
   - every row whose last part is a sole "dried"/"powder"/"dehydrated" (139 queries): 25 flipped before the review exemptions, 22 on the merged code. They include "thyme"/"rosemary" → fresh and "currant" → fresh red currant;
   - a 53-name × 4-shape nut/seed grid: 19 flips, 13 of them to oil-roasted rows (0 after the exemptions).

   Run the grid against the pre-fix commit as a control: a clean zero only counts if the same grid shows the flips before the fix.
6. Report both versions' numbers and the residuals. One tuning pass, then stop.

### Near ties go to the shortest description, which is often the processed form

Rows that share the head word ("Milk, …", "Egg, chicken, …") score the same on structure, and
the length penalty then picks the shortest: "Milk, dry whole" (496 kcal/100 g) over "Milk,
fluid, …", "Beans, black, flour" over "Beans, black, mature seeds, raw". #1126 takes one
point off a description with dry/dried/powder/dehydrated/flour the query did not name. It
exempts three CNF spellings that are not processed products: a comma part that is only
"dry" (a grain's raw state: "Grains, quinoa, dry"), "dry roasted" (a method), and a sole
"dried" part on a Nuts/Seeds row (the plain shelled nut). The last two exemptions came from
review, not from the gold set. Measured residuals (cocoa, currant, dried herbs, bare "egg")
are an acceptance criterion in the P3 matcher todo.

In tests, pair every absence assertion (`toBeUndefined()`, "does not rewrite") with a positive control in the same block, and build fixtures from **real** rows with each old-scorer trap beside its correct sibling.

## Related Files

- `server/services/nutrition-lookup.ts`: `scoreCNFMatch`, `isUnaskedDehydratedForm` (#1126), `matchWords`, `withoutLeadingQuantity`, `fuzzyMatchCNF`
- `server/services/cultural-food-map.ts`: `ALIAS_PATTERNS`, `lookupCulturalFood`
- `server/services/barcode-lookup.ts`: OFF-vs-CNF cross-validation uses the same scorer (50 OFF category terms: 41 → 46 matched)

## See Also

- [quantity-in-nutrition-lookup-query-does-not-scale-result](quantity-in-nutrition-lookup-query-does-not-scale-result-2026-09-27.md) — the scaling half of the same Quick Log incident
- [name-matched-secondary-must-not-replace-self-consistent-label](name-matched-secondary-must-not-replace-self-consistent-label-2026-07-17.md) — why a name match must never override identity-matched barcode data
