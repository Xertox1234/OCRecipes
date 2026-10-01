---
title: "USDA search takes the top hit even when it is an unrelated branded product"
track: bug
category: logic-errors
tags: [architecture, typescript, matching, measurement, caching]
module: server
applies_to: [server/services/nutrition-lookup.ts]
symptoms: ["Doro wat resolves to YO DORO WAFERS WITH HAZELNUTS (shares the word doro)", "Gyoza resolves to GYOZA DIPPING SAUCE, GYOZA (shares gyoza, echoed as trailing comma-part)", "Single-word dish queries return unrelated branded products that merely contain the query word", "USDA search with pageSize=1 returns whatever comes first unconditionally"]
created: 2026-09-27
last_updated: 2026-09-27
severity: high
---

# USDA search takes the top hit even when it is an unrelated branded product

## Problem

`lookupUSDA` in `server/services/nutrition-lookup.ts` requested `pageSize=1` from USDA FoodData Central and returned whatever came back unconditionally. For some dish names, the USDA top-1 hit was a Branded product sharing one word with the query rather than naming the dish itself. A single-request top-1 design has no opportunity to reject a bad match because there is no alternative candidate to compare against.

## Symptoms

- "doro wat" resolves to "BAMBI, YO DORO WAFERS WITH HAZELNUTS" — the wafer's description contains the word "doro", but the product is unrelated to the Ethiopian chicken stew.
- "gyoza" resolves to "GYOZA DIPPING SAUCE, GYOZA" — the product name contains "gyoza", but the result is a dipping sauce, not the dumplings.
- Any single-word dish query risked returning a branded product that merely contains the query word as a substring or whole word.

## Root Cause

Two proposed fixes failed live-API testing before the correct approach was found:

1. **Whole-word coverage (every query word must appear in description)**: This works for multi-word queries like "doro wat" — each word must match, so "YO DORO WAFERS WITH HAZELNUTS" fails because "wat" is absent. However, it cannot fix single-word queries: any top Branded candidate for a single-word query trivially contains that word. "gyoza" → "GYOZA DIPPING SAUCE, GYOZA" passes because both "gyoza" words appear in the description.

2. **Generic-data-types-first (Foundation/SR Legacy only)**: This regressed "jollof rice" on live testing. The generic-only result set contained "Dirty rice, Rice dressing" (both wrong), which would rank above the correct Branded "JOLLOF RICE, JOLLOF" once Branded was excluded. Excluding Branded outright discards many correct answers.

3. **Bidirectional whole-description word-set-equality**: This correctly rejects "GYOZA DIPPING SAUCE, GYOZA" (the description has extra words the query lacks), but ALSO incorrectly rejects three currently-correct generic answers that legitimately carry extra qualifier words: "Injera, Ethiopian bread", "Biryani with vegetables", "Soup, pho, with meat". Generic USDA rows are taxonomic (Head, qualifier); a single universal rule cannot distinguish between a branded product's spurious extra words and a generic row's legitimate qualifier.

Additionally, a comma-joined multi-value `dataType` query param (`dataType=Foundation,SR Legacy`) returns HTTP 400 from the live USDA FDC search endpoint. Multi-value `dataType` must be sent as repeated `dataType=` params via `URLSearchParams.append`, not comma-joined — confirmed live, independent of the word-matching design.

## Solution

Apply word coverage to every candidate, AND, for Branded candidates only, additionally require the description head (first comma-part, or whole description if none) to be an EXACT bidirectional word-set match for the query (plural-tolerant via `wordMatch`), after stripping a leading quantity via `withoutLeadingQuantity(matchWords(query))`. Generic rows skip the head-exact check.

Fetch `pageSize=5` unfiltered (still one request) and take the first candidate passing both checks. The head-exact rule correctly rejects "GYOZA DIPPING SAUCE, GYOZA" (`dataType: "Branded"`) because the query contains only the word "gyoza" while the head "GYOZA DIPPING SAUCE" also contains "DIPPING" and "SAUCE". "Injera, Ethiopian bread" and "Biryani with vegetables" are `Foundation`/`Survey (FNDDS)` rows, not Branded — the head-exact check never runs for them at all, which is exactly why their legitimate extra qualifier words ("Ethiopian bread", "with vegetables") don't get them wrongly rejected.

**Measurements**: Live measurement over 34 queries through the real `lookupNutrition` with `DATABASE_URL` pointed at an unreachable host (cache read fails soft): 28 right / 6 wrong / 0 no-match before to 29 right / 3 wrong / 2 no-match after, zero regressions. "gyoza" now resolves to "STEAMED DUMPLINGS" (224 kcal) via the cultural-map fallback; "doro wat" ends in no-match (acceptable per the todo AC: not required to resolve to something, only required to not be the wrong wafer row).

## Prevention

1. **Cache real API responses offline before iterating acceptance rules.** Fetch real API top-5 candidates ONCE per query, cache raw description + dataType to a scratch file, then iterate acceptance rules against that cache. This avoids live-testing each rule change against a flaky external API and makes regression detection reproducible.

2. **Look for a genuine structural discriminator before uniformly strengthening one rule.** A rule strict enough to reject one bad match can be too strict for a structurally different but currently-correct match. The correct discriminator here was the row's `dataType` field — Branded rows name one specific product; generic USDA rows are taxonomic with legitimate extra qualifier words.

3. **Verify multi-value filter param encoding early.** A working POST-body array shape does not imply the same values comma-join safely into a GET query string. Test multi-value params against the live API with `URLSearchParams.append` before assuming comma-joined encoding works.

4. **Reuse the same query tokenization at every acceptance-rule call site.** Use `withoutLeadingQuantity(matchWords(query))` consistently, or a caller-added quantity prefix silently fails an exact or coverage rule.

## Related Files

- `server/services/nutrition-lookup.ts`: `lookupUSDA`, `usdaCoversQuery`, `usdaHeadMatchesQuery`, `usdaFoodSchema` `dataType` field, `matchWords`, `withoutLeadingQuantity`
- `server/services/__tests__/nutrition-lookup.test.ts`: USDA branded candidate filter describe block

## See Also

- [food-name-matcher-whole-words-gold-set-2026-09-27.md](food-name-matcher-whole-words-gold-set-2026-09-27.md) — the CNF-scorer sibling fix in the same file
- [truncate-before-rank-discards-best-candidates-2026-08-06.md](truncate-before-rank-discards-best-candidates-2026-08-06.md) — the general cheap-proxy-top-1-vs-real-criterion shape this bug is one instance of