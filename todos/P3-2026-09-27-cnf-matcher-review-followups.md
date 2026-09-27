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
