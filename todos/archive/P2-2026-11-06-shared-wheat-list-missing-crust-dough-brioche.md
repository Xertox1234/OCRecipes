---
title: "Shared wheat/gluten allergen list misses pie crust, pizza dough and brioche"
status: done
priority: medium
created: 2026-11-06
updated: 2026-11-15
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

### 2026-11-14

- Code done: "pie crust", "pizza dough", "brioche" and "brioches" are direct-tier wheat keywords; `WHEAT_TERMS_MISSING_FROM_SHARED` is removed. Criteria 1–3 met.
- Still open (criterion 4, owner): prod allergen backfill, then a server restart; an OTA for the client list. This todo stays open until those run.
- Owner asked ("Batch") for the unambiguous common wheat foods in one more PR before the backfill, so the chain runs once: breads, pasta shapes, pastry, wrappers, freekeh, plus "shellfish"/"crustacean". The "Make gluten-free" remix chip now uses the whole-word matcher.
- Left out, owner's call (the name also covers gluten-free dishes, or was not in the approved groups): cake, cookie, muffin, biscuit, cereal, granola, gravy, stuffing, toast, sandwich, rolls, pancake mix, waffle, crepe, wafer, cone, pie shell, tart shell, breading, roux, soba, lo mein, vermicelli, graham, rusk.

### 2026-11-06

- Initial creation (data-integrity audit 2026-11-05, M3 review follow-up)

## Resolution (2026-11-15)

- #1875 added pie crust, pizza dough and brioche; #1876 added 71 more wheat keywords and moved the "Make gluten-free" chip to the whole-word matcher; #1877 added the "possible" level for ambiguous foods across all nine allergens.
- Production allergen backfill and server redeploy ran on 2026-11-14 and again on 2026-11-15 (31 community + 0 meal-plan recipes each time).
- Preview OTA published 2026-11-15 (update group fbf6ad41, runtime 5.2.0). The production channel was not published: production builds are still on runtime 5.0.0.
