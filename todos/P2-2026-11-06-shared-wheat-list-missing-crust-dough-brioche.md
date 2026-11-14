---
title: "Shared wheat/gluten allergen list misses pie crust, pizza dough and brioche"
status: backlog
priority: medium
created: 2026-11-06
updated: 2026-11-06
assignee:
labels: [deferred, data-integrity, allergens]
github_issue:
---

# Shared wheat/gluten allergen list misses pie crust, pizza dough and brioche

## Summary

`ALLERGEN_INGREDIENT_MAP.wheat` in `shared/constants/allergens.ts` has no keyword that matches "pie crust", "pizza dough" or "brioche", so a recipe whose only wheat source is one of them is not flagged for a wheat/gluten allergy and can carry the gluten-free icon.

## Background

Found while fixing the 2026-11-05 data-integrity audit finding M3 (the recipe wizard's private gluten list ignored oats). M3 switched the wizard to `deriveRecipeAllergens`; code-reviewer then showed (probe) that the three terms the old private list caught are absent from the shared list ("crust" only matches `crustacean`). The wizard keeps them as `WHEAT_TERMS_MISSING_FROM_SHARED` in `client/lib/recipe-tag-inference.ts` until the shared list has them.

Deferred, not fixed in the audit, because a shared allergen keyword change follows the oats ruling chain (owner, 2026-10-16): OTA + prod allergen backfill + server restart.

## Acceptance Criteria

- [ ] `shared/constants/allergens.ts` wheat list matches "pie crust", "pizza dough" and "brioche" (multi-word keywords match by substring; check single words against the whole-word matcher)
- [ ] Allergen tests cover each term, plus a control that does not over-match (e.g. "crustacean" stays shellfish-only)
- [ ] `WHEAT_TERMS_MISSING_FROM_SHARED` removed from `client/lib/recipe-tag-inference.ts`; its regression rows in `client/lib/__tests__/recipe-tag-inference.test.ts` still pass
- [ ] Prod allergen backfill run after deploy, then restart (oats-ruling chain); OTA published for the client list

## Implementation Notes

- Files: `shared/constants/allergens.ts`, `shared/constants/__tests__/` (allergen tests), `client/lib/recipe-tag-inference.ts`, `client/lib/__tests__/recipe-tag-inference.test.ts`
- The recipe `allergens` column is a denormalised cache (`deriveRecipeAllergens`), so existing recipes keep the old result until backfilled.

## Scope Contract

- **Mechanisms to use:** the existing keyword list and backfill — nothing new
- **Files in scope:** the four files above
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- Owner runs the prod allergen backfill (prod writes are owner-run)

## Risks

- Over-matching: keep "crust"/"dough" out as bare single words unless the whole-word matcher makes them safe ("doughnut", "crustacean")

## Updates

### 2026-11-06

- Initial creation (data-integrity audit 2026-11-05, M3 review follow-up)
