---
title: "Universal 'Contains: <allergen>' label on all recipes (profile-independent)"
status: backlog
priority: medium
created: 2026-07-20
updated: 2026-07-20
assignee:
labels: [deferred, client, allergen, safety]
github_issue:
---

# Universal "Contains: <allergen>" label on all recipes (profile-independent)

## Summary

Show a prominent, **universal** "Contains: Nuts" (and other derived allergens)
label on every recipe that contains a known allergen — visible to **all** users
regardless of whether they have declared that allergy. Nut labeling is the
driving case; the recipe's full derived allergen set comes along nearly for free.

## Background

Requested by the user as an added allergen-safety precaution alongside the Smart
Scan personalization spec (`docs/superpowers/specs/2026-07-20-smart-scan-personalization-design.md`).

Filed as a separate todo because it is a **different surface and a different
model** from that spec:

- **Surface:** recipe display screens/cards, not the scan/barcode flow.
- **Model:** _universal precautionary_ labeling, not _personalized_ matching.

Today, all recipe allergen UI is personalized to the viewer:

- `client/components/AllergenWarningBanner.tsx` renders "N ingredient(s) contain
  **your** allergens" — it only fires on matches against the viewer's declared
  `allergies`.
- `client/components/AllergenBadge.tsx` renders a severity-coded badge, where the
  severity comes from the viewer's own allergy record.

Consequence: a nut-containing recipe shows **no allergen indication at all** to a
user who has not declared a nut allergy (a not-yet-onboarded user, a household
member browsing on someone else's account, someone checking a recipe for a guest).
This todo closes that gap with a blanket label driven by the recipe's own data.

The data already exists: recipes carry a derived `allergens` array
(`deriveRecipeAllergens` in `shared/constants/allergens.ts`), persisted on
`communityRecipes.allergens` / `mealPlanRecipes.allergens`. This is a **display**
task, not a data or matching task.

## Acceptance Criteria

- [ ] Every recipe display surface renders a prominent, profile-independent
      "Contains: <allergens>" label derived from the recipe's own `allergens`
      field — NOT filtered by the viewer's declared allergies.
- [ ] Nut-containing recipes ("Contains: Nuts" / "Contains: Peanuts, Tree nuts")
      are labeled; the label generalizes to the full 9-class allergen set the
      recipe carries.
- [ ] The universal label is placed prominently (at/near the recipe title/header),
      distinct from — and coexisting with — the existing personalized
      `AllergenWarningBanner` (which stays as-is for viewer-specific escalation).
- [ ] Reuses the existing `AllergenBadge` component and the already-derived
      `recipe.allergens` data — no re-derivation, no new allergen engine.
- [ ] **Fail-dangerous invariant:** a recipe with missing/unpopulated derived
      allergen data must NOT render "no allergens" or imply allergen-free. Absence
      of derived data is not a safety guarantee — render nothing (or an explicit
      "allergens not verified"), never a green "safe" signal. (Mirrors the Smart
      Scan spec's allergen-unverified invariant.)
- [ ] Covered by render tests (utils-extracted where a component holds logic):
      universal label appears for a nut recipe when the viewer has no nut allergy;
      no false "safe" label when `allergens` is empty/undefined.

## Implementation Notes

- Confirmed recipe display surfaces to cover (verify completeness during impl):
  - `client/components/RecipeDetailContent.tsx`
  - `client/components/recipe-chat/RecipeCard.tsx`
  - `client/screens/FeaturedRecipeDetailScreen.tsx`
  - `client/components/recipe-detail/*` (e.g. `RecipeIngredientsList.tsx`)
- Source of allergen data: `recipe.allergens` (`DerivedRecipeAllergen[]`), derived
  via `deriveRecipeAllergens` (`shared/constants/allergens.ts`). Read-only reuse.
- Keep the personalized path intact: `AllergenWarningBanner` continues to escalate
  for the viewer's own allergens (severity-coded). The new label is the calm,
  universal baseline that is always shown.
- **Synergy with the Smart Scan spec:** if that feature produces a shared
  "allergen chip" presentation component, prefer sharing it here rather than
  forking a second style. This todo can land independently and before/after the
  scan work — no hard dependency.
- Do not re-derive allergens client-side; if a surface lacks the derived field,
  fix the data plumbing rather than re-running detection in the component.

## Scope Contract

- **Mechanisms to use:** existing `AllergenBadge` component + already-derived
  `recipe.allergens` data. No new allergen engine, no new matching logic.
- **Files in scope:** the recipe display components/screens listed above and any
  their render tests. `shared/constants/allergens.ts` is read-only (reuse only).
- **Out of scope:** the scan/barcode flow (that is the separate Smart Scan spec),
  the personalized `AllergenWarningBanner` behavior, and any change to how
  `deriveRecipeAllergens` computes allergens.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None hard. Optional soft synergy: reuse a shared allergen-chip component if the
  Smart Scan feature introduces one.

## Risks

- **False safety signal** is the main risk — see the fail-dangerous criterion.
  Never let "we didn't derive allergens" render as "allergen-free."
- Surface completeness: missing a recipe card variant would leave a gap; enumerate
  all recipe-rendering components during implementation.
- `safety`-labeled → individual human review required; never auto-merge.

## Updates

### 2026-07-20

- Initial creation. Filed from the Smart Scan personalization brainstorming
  session as an out-of-scope, user-requested followup.
