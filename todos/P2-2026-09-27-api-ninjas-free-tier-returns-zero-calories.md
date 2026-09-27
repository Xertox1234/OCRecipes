---
title: "API Ninjas' free tier hides calories and protein, so a lookup that falls through to it returns 0 kcal"
status: backlog
priority: medium
created: 2026-09-27
updated: 2026-09-27
assignee:
labels: [deferred, nutrition]
github_issue:
---

# API Ninjas' free tier hides calories and protein, so a lookup that falls through to it returns 0 kcal

## Summary

When CNF and USDA both miss, `lookupNutrition` returns API Ninjas' result, whose calories
and protein are 0 on our key. Callers get a real-looking 0 kcal food. Fix it by refusing
or completing a result with gated fields.

## Background

Found during the PR #1124 review (beverage logging). Measured 2026-09-27 with our
`API_NINJAS_KEY`, `GET /v1/nutrition?query=kombucha`:

```
"calories": "Only available for premium subscribers.", "serving_size_g": 100.0,
"protein_g": "Only available for premium subscribers.", "fat_total_g": 0.2, ...
```

- `apiNinjasItemSchema` (`server/services/nutrition-lookup.ts`) coerces every
  non-numeric field to `0` (`coerceNumber`), so calories and protein become 0.
- `lookupAPINinjas` returns that result as is. The comment says it is "still useful for
  macro breakdown".
- `lookupNutrition` skips caching it (`calories > 0` guard) but **still returns it**.
- **Callers that save 0:**
  - The beverage route saves 0 kcal for a custom drink that CNF and USDA both miss.
  - Quick Log (`food-nlp.ts`) shows and logs 0 kcal for such a food.
  - Photo and cooking callers go through `batchNutritionLookup`; check it.
- **Serving size:** it is not gated on our key (100.0). If it ever were, `coerceNumber`
  would make it `"0g"`. The beverage route already returns 422 for that; `toPortion` in
  `food-nlp.ts` would keep the values under a "0g" label.

## Acceptance Criteria

- [ ] A result whose calories were gated is not returned as a 0 kcal food. Either:
  - it becomes null, so the caller shows "not found" or manual entry; or
  - it is completed another way, e.g. calories estimated from the macros, only if every
    macro used is ungated.
- [ ] Gated values are told apart from real zeros. Water, black coffee and diet soda are
      real 0 kcal foods.
- [ ] A test with the premium-gated response shape above covers `lookupNutrition`.

## Implementation Notes

- Parse the gated string as "missing" (e.g. `null`) instead of `0`, then decide in
  `lookupAPINinjas`.
- `server/services/nutrition-lookup.ts` (`coerceNumber`, `apiNinjasItemSchema`,
  `lookupAPINinjas`, `lookupNutrition`) and
  `server/services/__tests__/nutrition-lookup.test.ts`.
- `toPortion` in `server/services/food-nlp.ts` keeps an unweighable basis's values under
  its label. A `"0g"` basis should count as unusable there too; see
  `normalizeToPerHundredGrams`' `!(grams > 0)` check in `barcode-lookup.ts`.
