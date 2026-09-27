---
title: "CNF matcher follow-ups: missing serving units, a committed gold set, and cheaper scoring"
status: backlog
priority: low
created: 2026-09-27
updated: 2026-09-27
assignee:
labels: [deferred, architecture]
github_issue:
---

# CNF matcher follow-ups: missing serving units, a committed gold set, and cheaper scoring

## Summary

Non-blocking findings from the PR #1120 reviews of the whole-word CNF scorer
(`scoreCNFMatch` in `server/services/nutrition-lookup.ts`). None is a regression from
#1120; each narrows a residual or makes the scorer's measurement repeatable.

## Background

#1120 rewrote the CNF matcher (right food 12 → 41 of 51 on a labeled gold set) and added
`withoutLeadingQuantity`, which strips a leading quantity run using the `QUANTITY_UNITS`
list. Reviewers flagged, as advisory:

1. **Missing units.** Cooking sessions send `"${quantity} ${unit} ${name}"`. Units not in
   `QUANTITY_UNITS` stay in the query and fail the every-word rule, so CNF returns null and
   the lookup falls to USDA: "1 pinch salt", "3 stalk celery", "2 sprig thyme", "1 head
   lettuce" (also null before #1120). Safe to add under the starts-with-a-number guard:
   `pinch, dash, stalk, sprig, bunch, head, ear, wedge, sheet, stick, container, envelope`.
   **Not** `clove`/`cloves`: it's also a CNF spice ("Spices, cloves, ground"), the same
   ambiguity as "cup noodles".
2. **No committed gold set.** The 51-query right/wrong/no-match measurement is cited in the
   docstring and PR but not in the repo, so a future scorer change has no baseline to diff
   against.
3. **Bare "rice" → "Rice, Spanish rice".** The head-part edge plus the parts-count penalty
   favour short dish names over CNF's canonical "Grains, rice, white, long-grain, …" rows.
   One of the 6 disclosed wrong answers.
4. **Dead regex branch.** `isNumberWord`'s decimal branch (`(?:[.,]\d+)?`) never fires:
   `matchWords` already splits "1.5" into "1", "5".
5. **Re-tokenization per query.** `scoreCNFMatch` re-tokenizes every CNF description and
   comma-part on every query (~7.8 ms/query on the EN list). Precomputing once alongside
   `cnfFoodsEN`/`cnfFoodsFR` in `ensureCNFFoods` would remove it.
6. **Docstring residual.** Open Food Facts product names with brand/form words ("Hot
   Chocolate K-Cup Pods") now fail the every-word rule, so barcode CNF cross-validation
   fires less often for them. List it beside the other residuals.
7. **A bare dish word picks a row that only mentions it.** Once the cultural-map fallback
   (P1 cultural todo) let CNF see dish names as typed, bare "taco" and "tacos" (and
   "1 taco") match "Snacks, tortilla chips, taco" (480 kcal/100 g) because a comma-part
   that _is_ the query outranks "Fast foods, mexican, taco with beef, …" (206), where it
   only starts the part. "beef taco" and "chicken taco" resolve correctly. Same class:
   "guacamole" → "Fast foods, mexican, tostada with guacamole", "buttermilk" →
   "Pancake, buttermilk, homemade", "ramen" → "Soup, ramen noodles, any flavour, dry".

## Acceptance Criteria

- [ ] The safe units above are in `QUANTITY_UNITS`, with a test per new unit that
      "<n> <unit> <food>" resolves like "<food>", plus a positive control that a food name
      containing the word (if any exists in CNF) still resolves to its own row.
- [ ] The gold set (queries + expected-row patterns) is committed as a fixture, with a test
      or script that prints right/wrong/no-match counts against a CNF list, and the
      docstring points at it.
- [ ] Bare "rice" resolves to a plain rice row, or the attempt and its gold-set
      before/after are recorded here if no tie-break helps without new wrong answers.
- [ ] The dead decimal branch is removed, or its comment says decimals arrive pre-split.
- [ ] Tokenization is precomputed once per CNF list load. Scoring results are identical on
      the gold set.
- [ ] The OFF brand-name residual is in the `scoreCNFMatch` docstring.
- [ ] Bare "taco" / "tacos" no longer resolve to the taco-flavoured chips row, or the
      attempt and its gold-set before/after are recorded here (item 7). Add these queries
      to the gold set either way.
- [ ] The beverage route's pinned lookup names are in the gold set, each expected to
      land on its row: "coffee, brewed" → Coffee, brewed; "tea, brewed" → Tea, brewed;
      "milk, 2%" → Milk, fluid, partly skimmed, 2% M.F.; "cola" → Carbonated drinks, cola;
      "cream, table" → Cream, table (coffee), 18% M.F.; "sugar, granulated" → Sweets,
      sugars, granulated (`shared/constants/beverages.ts`, PR #1124). The route tests mock
      the lookup, so only the gold set would catch a matcher change moving them.

- [ ] Dehydrated-form penalty residuals (PR #1126), each fixed or its attempt and gold-set
      before/after recorded here: "cocoa" → "Hot chocolate, cocoa, homemade…" (was cocoa
      powder); "currant(s)" → "Currant, red and white, raw" (was "Currant, zante, dried", the
      baking currant); "thyme"/"rosemary"/"dill weed" → their fresh rows (were dried); bare
      "cherries" → "Candied foods, cherries" (was dried; the fresh row loses on the plural
      rule). Add these queries to the gold set either way.

## Implementation Notes

- Every scorer change: re-run the gold set in all caller shapes (bare, `2 `, `1 cup `,
  `3 oz `, `1 medium `, `12oz `, `1/2 cup `) and the unit-word collision sweep, as
  `docs/solutions/logic-errors/food-name-matcher-whole-words-gold-set-2026-09-27.md`
  describes. Report right/wrong/no-match for both versions.
- A structurally better fix for item 1: `cooking-session.ts` already has the unit as a
  separate field and could leave it out of the query. The P1 cooking todo removes the
  quantity from the query entirely, which makes item 1 moot for that caller.

## Scope Contract

- **Mechanisms to use:** the existing `QUANTITY_UNITS` / `withoutLeadingQuantity` /
  `scoreCNFMatch` / `ensureCNFFoods`; a JSON fixture for the gold set.
- **Files in scope:**
  - `server/services/nutrition-lookup.ts`
  - `server/services/__tests__/nutrition-lookup.test.ts`
  - `server/services/__tests__/fixtures/cnf-gold-set.json` (new)
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None. Coordinate with `todos/P1-2026-09-27-photo-and-cooking-nutrition-use-per-100g-as-the-portion.md`
  (it changes the cooking query shape).

## Risks

- A tie-break for item 3 can trade one wrong answer for another. Measure it on the gold
  set, don't reason about it.

## Updates

### 2026-09-27

- Filed from the PR #1120 review passes (advisory findings, auto-filed per the Medium/Low
  policy).
- Item 7 added from the cultural-map fallback fix, measured through `lookupNutrition`.
- Dried/powder/flour forms now lose near ties (`isUnaskedDehydratedForm`, PR #1126, before
  the cooking per-100 g P1 so scaling doesn't multiply "milk" → dry milk powder). Gold set
  41/6/4 → 43/4/4 (51 queries); the six pinned beverage names are unchanged. Review found
  "dry roasted" (a method) and a Nuts/Seeds "dried" part (the plain shelled nut) wrongly
  penalized; both are exempt now (a generated 212-query nut/seed grid: 19 flips before the
  exemptions, 0 after). A generated sweep of every row whose last part is a sole
  dried/powder/dehydrated word (139 queries) flips 22, mostly toward the eaten form (soups,
  drinks, coffee, tomato); the regressions are the residual criterion above. Bare "egg" →
  "Egg, chicken, yolk, cooked" (the docstring's whole-egg claim was stale). Harnesses:
  baseline vs candidate over the gold set plus 103 pantry names, the dried-form sweep and the
  nut grid — a start for the committed-fixture criterion.
