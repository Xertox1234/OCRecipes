---
title: Allergen keyword matcher false-flags plant substitutes (almond milk → dairy)
track: bug
category: logic-errors
module: shared
severity: medium
tags: [allergens, nutrition, safety, string-matching, regex]
symptoms: [Dairy-free / gluten-free recipes excluded by the safeForMe filter, almond milk / oat flour / coconut cream / peanut butter tagged with dairy or wheat, Denormalized allergens cache contains allergens the recipe doesn't have]
applies_to: [shared/constants/allergens.ts]
created: '2026-05-20'
---

# Allergen keyword matcher false-flags plant substitutes (almond milk → dairy)

## Problem

The allergen detector (`ingredientContainsKeyword`) used bare single-word
keywords `milk`, `cream`, `butter` (dairy) and `flour` (wheat) with a
word-boundary regex. Those keywords match inside plant-substitute names —
"almond **milk**", "coconut **cream**", "peanut **butter**", "oat **flour**" —
so substitutes were tagged with the very allergen they replace. This poisoned the
denormalized `mealPlanRecipes`/`communityRecipes.allergens` caches and made the
`safeForMe` search filter exclude safe recipes for exactly the dietary-restricted
users it serves.

## Symptoms

- A dairy-free user's "oat milk" smoothie is flagged as containing milk.
- A gluten-free user's "almond flour" cake is excluded by `safeForMe`.
- `deriveRecipeAllergens(["almond milk"])` returned `milk` (should be `tree_nuts` only).

## Root Cause

Substring/boundary matching for allergens is asymmetric in risk but the matcher
treated all matches equally. A bare allergen keyword is ambiguous: "milk" alone is
dairy, but "<plant> milk" is not. The matcher had no notion of a qualifier that
negates the base allergen.

## Solution

A **plant-substitute guard** inside `ingredientContainsKeyword`: after a
single-word keyword matches at a boundary, if the keyword is one of the ambiguous
set (`milk`/`cream`/`butter`/`flour`) AND it is immediately preceded by a
strictly-plant-based qualifier ("almond", "oat", "soy", "coconut", "rice", …),
the match is suppressed. Suppression only removes the dairy/wheat allergen — the
substitute's OWN allergen still fires through its own keyword ("almond milk" loses
dairy but keeps `tree_nuts` via the `almond` keyword).

## Prevention

**The safety asymmetry is the load-bearing design rule.** For an allergen
classifier, over-flagging is annoying-but-safe; under-flagging is dangerous (a
real allergen goes unannounced). So any change that _removes_ a flag must be
provably conservative:

- The modifier list must be **strictly plant bases**. Animal-milk qualifiers
  (goat, sheep, buffalo, camel) are dairy and are deliberately excluded — adding
  one would turn a safe over-flag into a dangerous under-flag.
- Gluten-containing grains (spelt, rye, barley) must NOT be modifiers — only
  genuinely gluten-free substitute flours suppress the `flour`/wheat keyword.
- Suppression is by **ingredient-text semantics** only ("oat flour" doesn't
  assert wheat). Cross-contamination ("may contain wheat") is a separate advisory
  channel, not derivable from the ingredient name.
- Regression tests must assert the **must-still-flag negatives** (plain milk,
  whole/skim milk, buttermilk, ice cream, wheat/white/bread/all-purpose flour),
  not just the new positives. Those negatives are what prove no under-flag crept
  in.

After changing the matcher, the denormalized `allergens` caches are stale —
re-run `server/scripts/backfill-recipe-allergens.ts` to re-derive.

## Related Files

- `shared/constants/allergens.ts` — `ingredientContainsKeyword`, `SUBSTITUTE_MODIFIERS`, `MODIFIER_SENSITIVE_KEYWORDS`
- `shared/constants/__tests__/allergens.test.ts` — substitute + must-still-flag tests
- `server/services/recipe-search.ts` — `safeForMe` predicate (consumer)
- `server/scripts/backfill-recipe-allergens.ts` — cache re-derive

## See Also

- `docs/audits/2026-05-20-full.md` — finding M1
