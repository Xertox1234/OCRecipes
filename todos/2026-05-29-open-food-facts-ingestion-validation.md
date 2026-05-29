---
title: "Validate Open Food Facts ingestion before it feeds the nutrition cache"
status: backlog
priority: medium
created: 2026-05-29
updated: 2026-05-29
assignee:
labels: [reliability, data-integrity, deferred, database]
github_issue:
---

# Open Food Facts ingestion validation (H6)

## Summary

`server/services/nutrition-lookup.ts:873-889` reads Open Food Facts `nutriments` as `Record<string, any>` (`nm["energy-kcal_100g"]`, `nm.proteins_100g`, …) with no validation before the values feed `offPer100g` and the (monetized) nutrition cache. A wrong-typed/garbage upstream value can poison cached macros.

## Background

Reliability audit Class 8 (boundary validation). The audit fixed the CNF and USDA-UPC ingestion paths (H5, M4) with lenient Zod `safeParse → fall through`, but **H6 (OFF) was deferred** because the OFF integration reads ~10 fields across name/category/nutriment surfaces and the nutriment values need careful drop-vs-coerce handling (OFF sometimes returns strings / `"N/A"`), with regression tests on the monetized path — more than a surgical audit edit.

## Acceptance Criteria

- [ ] OFF nutriment numeric fields used in `offPer100g` are validated to be finite numbers before use; non-numeric/garbage values are dropped (under-report is the safe direction for a monetized DB), not silently written as strings/NaN.
- [ ] The genuine-empty case (OFF has no product) remains a valid "no data" result, distinct from a parse failure.
- [ ] Regression tests: a valid OFF product still parses; an OFF product with a string/`"N/A"` nutriment does not poison the cache.

## Implementation Notes

- Follow the in-file pattern established by the audit for CNF/USDA-UPC: a lenient Zod schema (`.passthrough()` / `.optional()`, coerce or drop numerics) parsed at the boundary, falling through on failure.
- The OFF field reads are already null-safe via optional chaining; the gap is specifically numeric-type trust on `nm.*_100g`.
- File: `server/services/nutrition-lookup.ts` (~820-890, the OFF branch).

## Dependencies

- None.

## Risks

- Over-strict validation could drop valid products → keep it lenient (validate shape, coerce/drop only the numeric values).

## Updates

### 2026-05-29

- Created from the reliability audit (H6). Deferred from the surgical set: needs a tested drop-vs-coerce design on the monetized cache path.
