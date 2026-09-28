---
title: "CNF matcher follow-ups: missing serving units, a committed gold set, and cheaper scoring"
status: done
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

- [x] The safe units above are in `QUANTITY_UNITS`, with a test per new unit that
      "<n> <unit> <food>" resolves like "<food>", plus a positive control that a food name
      containing the word (if any exists in CNF) still resolves to its own row.
- [x] The gold set (queries + expected-row patterns) is committed as a fixture, with a test
      or script that prints right/wrong/no-match counts against a CNF list, and the
      docstring points at it.
- [x] Bare "rice" resolves to a plain rice row, or the attempt and its gold-set
      before/after are recorded here if no tie-break helps without new wrong answers.
- [x] The dead decimal branch is removed, or its comment says decimals arrive pre-split.
- [x] Tokenization is precomputed once per CNF list load. Scoring results are identical on
      the gold set.
- [x] The OFF brand-name residual is in the `scoreCNFMatch` docstring.
- [x] Bare "taco" / "tacos" no longer resolve to the taco-flavoured chips row, or the
      attempt and its gold-set before/after are recorded here (item 7). Add these queries
      to the gold set either way.
- [x] The beverage route's pinned lookup names are in the gold set, each expected to
      land on its row: "coffee, brewed" → Coffee, brewed; "tea, brewed" → Tea, brewed;
      "milk, 2%" → Milk, fluid, partly skimmed, 2% M.F.; "cola" → Carbonated drinks, cola;
      "cream, table" → Cream, table (coffee), 18% M.F.; "sugar, granulated" → Sweets,
      sugars, granulated (`shared/constants/beverages.ts`, PR #1124). The route tests mock
      the lookup, so only the gold set would catch a matcher change moving them.

- [x] Dehydrated-form penalty residuals (PR #1126), each fixed or its attempt and gold-set
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

- None. Coordinate with `todos/archive/P1-2026-09-27-photo-and-cooking-nutrition-use-per-100g-as-the-portion.md`
  (it changes the cooking query shape).

## Risks

- A tie-break for item 3 can trade one wrong answer for another. Measure it on the gold
  set, don't reason about it.

## Updates

### 2026-09-27

- Filed from the PR #1120 review passes (advisory findings, auto-filed per the Medium/Low
  policy).
- **Implemented (todo-executor run), measured against the real 5,690-row CNF EN list
  (downloaded fresh, not committed):**
  - **Units (item 1):** added `pinch(es)`, `dash(es)`, `stalk(s)`, `sprig(s)`, `bunch(es)`,
    `head(s)`, `ear(s)`, `wedge(s)`, `sheet(s)`, `stick(s)`, `container(s)`, `envelope(s)` to
    `QUANTITY_UNITS` (not `clove`/`cloves` — still a CNF spice name). Verified: none of the
    12 is the _leading_ word of any real CNF row, so `withoutLeadingQuantity`'s guard (only
    strips a leading run) has no real collision to protect against; mid-name occurrences
    ("Broccoli, stalks, raw", "Fish, fish sticks, …", "Pork, ears, …", "Potato, …, wedge
    cut, …") are untouched regardless and are covered by tests anyway.
  - **Gold set (item 2):** committed as `server/services/__tests__/fixtures/
cnf-gold-set.json` — the original 51 queries (from the archived
    `P1-2026-09-27-cultural-map-replaces-the-whole-query.md`, reproduced byte-for-byte:
    43/4/4 against the real list, confirming the fixture's patterns are correct) plus 16
    new queries for items 7/8 and the beverage-pinned names. A new
    `nutrition-lookup.test.ts` describe block ("fuzzyMatchCNF — committed gold set") loads
    the fixture, scores it against a curated ~60-row subset of real CNF descriptions
    (verified 2026-09-27 to reproduce the SAME classification, query-for-query, as the full
    5,690-row list — 0 mismatches), logs the counts, and asserts both the exact right/
    wrong/no-match counts (52/11/4) AND the exact wrong/no-match query SETS, so a tie-break
    that trades one wrong answer for another fails the test even if the totals still add
    up. `scoreCNFMatch`'s docstring points at the fixture.
  - **Rice (item 3) — attempted, not fixed.** Every plain "rice" row in CNF has ≥4 comma
    parts ("Grains, rice, white, long-grain, …, cooked"); there is no 2–3 part canonical
    row. The only lever tried was removing the head-part edge entirely: this did NOT flip
    "rice" (the parts-count and length penalties alone still favour "Rice, Spanish rice")
    and regressed 5 other correct matches — apple → "Strudel, apple", potato → "Bread,
    potato", corn → "Tamale, corn", milk → "Cracker, milk", and the database-style
    "chicken, breast, roasted" → "Deli-meat, chicken breast, oven-roasted, sliced" (full
    gold set 43/4/4 → 38/9/4; bare "egg" is already one of the 4 baseline-wrong queries —
    it moves to a _different_ wrong answer, "Bagel, egg", not a regression from correct,
    so it is not one of the 5). No safe tie-break found; recorded per the AC's own escape
    hatch. Unchanged from #1120/#1122's baseline.
  - **Dead regex branch (item 4):** removed `isNumberWord`'s `(?:[.,]\d+)?` group; comment
    now says why (matchWords already splits on "." and ",", so a word never contains one).
  - **Tokenization (item 5):** added a `tokenizeDescription` memo cache keyed by the
    lowercased description string, warmed eagerly right after `ensureCNFFoods` parses a
    fresh CNF list (satisfies "precomputed once per CNF list load" literally) with a
    cache-miss fallback so ad-hoc test food lists (not loaded through `ensureCNFFoods`)
    still score correctly. `isUnaskedDehydratedForm` now takes the precomputed
    `partWordsList` too, instead of re-running `matchWords` per comma-part per query (review
    round 1 caught this half of item 5's own re-tokenization complaint as still-live).
    Gold set counts identical before/after (52/11/4; base-51 alone 43/4/4). Cache is
    cleared in `_resetCNFCacheForTesting`.
  - **OFF docstring (item 6):** added to `scoreCNFMatch`'s docstring.
  - **Taco (item 7) — attempted, not fixed.** One measured probe: removing the parts-count
    penalty (`>3` → multiplier 0) entirely does not flip "taco" (still "Snacks, tortilla
    chips, taco" at ~19.7 vs. the correct "Fast foods, mexican, taco with beef/chicken, …"
    at ~17.4 even with the penalty zeroed — the exact-part-match bonus and length penalty
    alone are enough) and the base-51 gold set is unaffected (still 43/4/4). No safe
    tie-break found. "taco"/"tacos"/"1 taco" added to the gold set as documented
    residuals; "beef taco"/"chicken taco" added as positive controls (already resolve
    correctly, unaffected). "guacamole", "buttermilk" and "ramen" (also named in the
    Background as "same class") were deliberately NOT added to the gold set: the todo
    names their current wrong answers but not a verified correct one, and inventing a
    target pattern would poison the fixture future executors short-circuit onto.
  - **Beverage pinned names:** "coffee, brewed" and "milk, 2%" were already in the base 51;
    added "tea, brewed", "cola", "cream, table", "sugar, granulated" (all 4 already resolve
    correctly — no code change, regression coverage only).
  - **Dehydrated-form residuals (item 8) — 3 of 6 fixed, 3 recorded.** Extended
    `isUnaskedDehydratedForm`'s Nuts/Seeds exemption to also cover a Spices row (a sole
    "dried" comma-part on a row headed "spices"): fixes bare "thyme"/"rosemary"/"dill weed"
    → their dried rows, restoring the pre-#1126 behaviour, with base-51 unaffected
    (43/4/4). **This is an order-dependent tie, not a scored preference**: with the penalty
    exempted, a spice's "dried" and "fresh" rows score identically, and `fuzzyMatchCNF`
    keeps the first max found. CNF's real EN list happens to list "dried" before "fresh"
    for dill weed/rosemary/thyme (so bare queries land on "dried") and "fresh" before
    "dried" for spearmint (so bare "spearmint" still resolves to fresh, untouched — not a
    gold-set item). If CNF ever reorders its list this tie flips; the docstring/comment say
    so. **Structural sweep (review round 1 asked for this):** every one of the 10 real CNF
    Spices rows whose last comma-part is a sole dried/powder/dehydrated word (basil,
    chervil, coriander leaf, dill weed, marjoram, parsley, rosemary, tarragon, thyme,
    spearmint) was queried bare, before/after the Spices exemption. Exactly 3 changed
    winner — dill weed, rosemary, thyme, the intended fixes — and 0 unintended flips: basil
    and parsley resolve to a _different_, non-Spices "X, fresh" row in both versions (so the
    exemption never applies to them); chervil, coriander leaf, marjoram and tarragon have no
    CNF "fresh" sibling at all (nothing to tie against); spearmint is unchanged (fresh, by
    list order, as above). "Cocoa", "currant"/"currants" and "cherries" were NOT fixed: for cocoa and currant
    the dehydrated-form penalty pushes the WRONG direction (their common form is the
    processed/dried one, unlike milk/beans/tomato), and even fully removing the penalty
    only just barely re-flips the winner (measured: cocoa's powder row would edge the hot-
    chocolate row by ~0.2 points — too thin a margin to trust, and there's no natural
    category (unlike Nuts/Seeds/Spices) to hang an exemption on without it being a
    single-food special case); "cherries" loses on the existing 0.8 plural-word-match
    discount, unrelated to the dehydrated-form penalty at all (a fix there would touch
    `wordMatch`'s plural handling broadly, unmeasured against the wider corpus — out of
    scope for this pass). All 6 added to the gold set as documented residuals/fixes per
    the AC's own escape hatch.
  - Net gold set: 52 right / 11 wrong / 4 no-match (67 queries). Before this pass's fixes,
    scoring all 67 queries would have been 49 right / 14 wrong / 4 no-match (thyme,
    rosemary and dill weed wrong instead of right); the base-51 subset is unchanged at
    43/4/4 either way.
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
