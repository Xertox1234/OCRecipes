---
title: "Allergen engine ingredient-text keywords are singular-only (plurals under-detected)"
status: done
priority: low
created: 2026-07-20
updated: 2026-07-20
assignee:
labels: [deferred, allergen, safety, shared]
github_issue:
---

# Allergen engine ingredient-text keywords are singular-only (plurals under-detected)

## Summary

The shared allergen engine (`shared/constants/allergens.ts`) matches ingredient
text with a **word-boundary** matcher, and most `directIngredients` keywords are
stored in the **singular** form only (`"peanut"`, `"almond"`, `"cashew"`,
`"walnut"`, …). Because the matcher requires the keyword to end at a boundary
(`[\s,;/()\-]` or end-of-string), a singular keyword does **not** match its
plural in ingredient text — e.g. the keyword `"peanut"` does not match
`"roasted peanuts"`. Plural forms are the common case in real ingredient lists,
so the ingredient-text detection path systematically **under-detects** allergens.

This is safety-relevant: under-detection of an allergen is a fail-_dangerous_
miss (silence read as "safe"). Severity is bounded because the primary signal in
the Smart Scan barcode path is Open Food Facts `allergens_tags` (structured),
with ingredient-text detection as the secondary fallback — but recipe-side
derivation (`deriveRecipeAllergens`) relies on the same keyword map and has no
tag fallback, so the recipe surface is more exposed.

## Background

Surfaced during Smart Scan Phase 1 (Task 3, safety core —
`docs/superpowers/plans/2026-07-20-smart-scan-phase1-allergen-safety.md`). That
task's mandated ingredient-text test (`"sugar, roasted peanuts, salt"` →
`peanuts`) failed against the engine because `"peanut"` singular does not match
`"peanuts"`. A **one-off** fix was applied for peanuts only (added `"peanuts"`
to that allergen's `directIngredients`, additive + regression-clean, approved by
the user for that PR). This todo tracks the **systemic** remainder: every other
allergen with a singular-only keyword has the same gap.

## Acceptance Criteria

- [ ] Ingredient-text detection matches common plural forms for every allergen,
      not just peanuts — verify `almonds`, `cashews`, `walnuts`, `hazelnuts`,
      `eggs` (already both), `soybeans`, `sesame seeds`, etc. via
      `detectAllergens` and `deriveRecipeAllergens`.
- [ ] Approach decided and documented: either (a) enumerate plural keywords
      alongside each singular in `ALLERGEN_INGREDIENT_MAP`, or (b) add a
      pluralization/stemming step to the matcher (`getKeywordPattern` /
      `ingredientContainsKeyword`). Option (b) is DRY but has a wider blast
      radius — weigh false-positive risk (e.g. do not let a stem over-match an
      unrelated ingredient).
- [ ] **Additive-only guarantee:** the change may only ADD matches, never remove
      one. Over-flagging is the safe direction; a removed match is a dangerous
      regression. Prove it with the full existing allergens regression suite
      staying green, plus new plural-form assertions.
- [ ] New tests cover the plural form of each allergen keyword (both
      `detectAllergens` and `deriveRecipeAllergens` paths).
- [ ] `safety`-labeled → individual human review required; never auto-merge.

## Implementation Notes

- Matcher: `getKeywordPattern` (`shared/constants/allergens.ts:613`) builds
  `(?:^|[\s,;/()\-])<kw>(?:$|[\s,;/()\-])`. The trailing boundary is why a
  singular keyword misses its plural. Single-word keywords go through the regex
  path; multi-word keywords use `includes()` (`ingredientContainsKeyword`:730).
- The plurals for irregular forms need care (`sesame seeds`, `soybeans`,
  `molluscs`); don't assume a naive `+ "s"` rule.
- Watch the `SUBSTITUTE_MODIFIERS` / `MODIFIER_SENSITIVE_KEYWORDS` plant-milk
  guard (`allergens.ts:642-715`) — any stemming change must not weaken it (that
  guard suppresses dairy/wheat for `"almond milk"` etc., and suppression must
  stay conservative to avoid a dangerous under-flag).
- The map is shared by scan-time flags AND recipe allergen derivation, so any
  change ripples to both surfaces — run both suites.

## Scope Contract

- **Files in scope:** `shared/constants/allergens.ts` and its test suite(s).
- **Out of scope:** the Smart Scan flag modules, route wiring, and UI — those
  are the Phase 1 plan; this is the shared engine only.
- No new abstractions beyond what the chosen approach requires.

## Risks

- **False positives** if stemming over-matches (e.g. a stem colliding with an
  unrelated ingredient). Prefer explicit plurals if stemming proves risky.
- **Dangerous regression** if a refactor removes an existing match — the
  additive-only guarantee + full regression suite is the guard.

## Updates

### 2026-07-20

- Filed from Smart Scan Phase 1 (Task 3). Peanuts got a one-off fix in that PR;
  this tracks the systemic plural gap across all allergens.
