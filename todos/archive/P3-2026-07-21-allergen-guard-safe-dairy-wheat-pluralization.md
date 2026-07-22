---
title: "Guard-safe pluralization for dairy/wheat allergen base keywords (milk, cream, butter, flour)"
status: done
priority: low
created: 2026-07-21
updated: 2026-07-21
assignee:
labels: [deferred, allergen, safety, shared]
github_issue:
---

# Guard-safe pluralization for dairy/wheat allergen base keywords

## Summary

The Smart Scan allergen plural-keyword pass (PR #684) added plural forms for most
allergen `directIngredients` keywords, but **deliberately left `milk`, `cream`,
`butter`, and `flour` singular-only** to avoid weakening the plant-substitute
guard (`SUBSTITUTE_MODIFIERS` / `MODIFIER_SENSITIVE_KEYWORDS` in
`shared/constants/allergens.ts`), which suppresses dairy/wheat flags for
`"almond milk"`, `"oat flour"`, etc. This todo closes that remainder **without**
weakening the guard: add the plural forms in a way that still lets the plant-milk
/ plant-flour suppression fire correctly.

## Background

Filed from the deferred-warnings triage of the 2026-07-21 `/todo` run (PR #684,
`allergen-engine-plural-keywords`). Two ai-reviewer suggestions were held back
from that PR because their blast radius touched the substitute guard or had
near-zero practical value:

1. **Guard-sensitive base words** (`milk`, `cream`, `butter`, `flour`) — pluralizing
   these naively risks a match ordering / suppression interaction with the
   plant-substitute guard. Needs its own careful pass with the guard regression
   suite front-and-center.
2. **Low-value mass/proper nouns** (`bread`/`breads`, and cheese varieties:
   `ricotta`, `mozzarella`, `parmesan`, `cheddar`, `gouda`, `brie`, `feta`,
   `mascarpone`, `paneer`) — these essentially never appear in plural form in real
   ingredient panels (mass/proper nouns), so their plurals rarely fire. Rolled in
   here as an **optional** secondary item, not a blocking requirement.

## Acceptance Criteria

- [ ] `milk`, `cream`, `butter`, `flour` match common plural forms in ingredient
      text (`detectAllergens` and `deriveRecipeAllergens`) — verified by new tests.
- [ ] **The plant-substitute guard still fires**: `"almond milk"`, `"oat milk"`,
      `"coconut cream"`, `"almond flour"`, `"oat flour"` etc. must NOT flag
      dairy/wheat. Prove it with the existing `SUBSTITUTE_MODIFIERS` /
      `MODIFIER_SENSITIVE_KEYWORDS` regression suite staying green, plus new
      assertions on the plural + modifier combination (e.g. `"almond milks"`).
- [ ] **Additive-only guarantee:** the change may only ADD dairy/wheat matches for
      genuine dairy/wheat text, never remove an existing match and never weaken a
      suppression. Over-flagging real dairy is the safe direction; under-flagging
      (or a broken suppression that over-flags a plant substitute) is the dangerous
      one. Full existing allergens regression suite must stay green.
- [ ] (Optional) `bread`/`breads` and cheese-variety plurals added **only if
      trivial and clearly safe** — decide during implementation; skip if they add
      never-firing noise or any guard risk. Not a blocking criterion.
- [ ] `safety`-labeled → individual human review required; never auto-merge.

## Implementation Notes

- Matcher: `getKeywordPattern` (`shared/constants/allergens.ts:~613`) builds
  `(?:^|[\s,;/()\-])<kw>(?:$|[\s,;/()\-])`. Single-word keywords take the regex
  path; multi-word keywords use `includes()` (`ingredientContainsKeyword`).
- The guard to protect: `SUBSTITUTE_MODIFIERS` / `MODIFIER_SENSITIVE_KEYWORDS`
  (`allergens.ts:~642-715`). Adding `"milks"` must not let `"almond milks"` slip
  past the modifier suppression — trace the interaction explicitly, and prefer
  explicit plural keywords over a stemming step if stemming widens the guard's
  blast radius.
- Prefer enumerating explicit plurals (Option (a) from PR #684) over a
  pluralization/stemming step, for the guard-sensitive words especially.
- The map is shared by scan-time flags AND recipe allergen derivation — run both
  suites.

## Scope Contract

- **Mechanisms to use:** explicit plural keyword additions in
  `ALLERGEN_INGREDIENT_MAP`; no new matcher/stemming mechanism unless proven
  guard-safe.
- **Files in scope:** `shared/constants/allergens.ts` and its test suite(s).
- **Out of scope:** Smart Scan flag modules, routes, UI, and the non-dairy/wheat
  allergens already handled in PR #684.
- No new abstractions beyond what the chosen approach requires.

## Dependencies

- Builds on PR #684 (`allergen-engine-plural-keywords`) — that PR should be merged
  first so this pass starts from the completed plural map. If #684 is still open at
  pickup time, start from its branch or wait for the merge.

## Risks

- **Guard weakening** is the primary risk: a dairy/wheat plural that defeats the
  plant-substitute suppression would flag `"almond milk"` as dairy — a false
  positive that erodes trust in the safety flags. The guard regression suite +
  explicit plural+modifier assertions are the mitigation.
- **Never-firing noise** if the optional mass/proper-noun plurals are added without
  judgment — keep that item optional and skip if not clearly worthwhile.

## Updates

### 2026-07-21

- Filed from the deferred-warnings triage of PR #684's `/todo` run. Consolidates
  the two held-back ai-reviewer suggestions (guard-sensitive dairy/wheat plurals +
  optional mass/proper-noun plurals) into one guard-safe pass.
- **Resolved (branch `allergen-guard-safe-dairy-wheat-plurals`).** Added `milks`,
  `creams`, `butters`, `flours` to both `ALLERGEN_INGREDIENT_MAP` and
  `MODIFIER_SENSITIVE_KEYWORDS` (the load-bearing invariant — each plural in both).
  Proved via a map-first red→green TDD cycle: with the plural in the map but not
  the guard set, `"almond milks"` derives dairy (the guard's target false
  positive); adding it to the guard set restores suppression. Both `detectAllergens`
  and `deriveRecipeAllergens` suites covered; downstream scan-flag suites green.
- **Optional item (AC #4) SKIPPED by decision:** `bread`→`breads` and the
  cheese-variety plurals (`ricottas`, `mozzarellas`, …) are mass/proper nouns that
  essentially never appear plural in ingredient panels — pure never-firing noise
  with no guard-safety upside. `cheeses`/`custards`/`yogurts`/`yoghurts` already
  had plurals. Not added.
