---
title: "Warn about an allergen clash when a meal is picked for the plan"
status: done
priority: medium
created: 2026-11-20
updated: 2026-11-27
assignee:
labels: [deferred, client, meal-plan, family, allergens]
github_issue:
---

# Warn about an allergen clash when a meal is picked for the plan

## Summary

Show an allergen warning at the moment a meal is added to the meal plan, checked against
whoever the meal is for. Today the clash is only visible after the meal has been added.

## Background

Owner decision, 2026-11-20, while reviewing the week grid restyle (PR #1955): the red allergen
warning triangle does not belong on a grid cell. Whether a meal clashes with an eater's allergy
should be shown when the meal is chosen. PR #1955 removed the triangle from
`client/components/meal-plan/WeekGridCell.tsx`; the family audience badge stayed.

What the app does now:

- The add menu has a "Who's it for?" row (`client/hooks/useMealPlanSheets.tsx`,
  `client/lib/plan-audience.ts`), so the eater is known at pick time. No allergen check runs
  against that eater there.
- After the meal is added, the day screen shows the clash as text
  (`client/screens/meal-plan/MealPlanDayScreen.tsx`, `client/components/meal-plan/MealSlotItem.tsx`),
  for example "Contains tree nuts — Ivy".
- The grid cell's spoken label still says "allergen warning". Nothing on the grid shows it.

So between picking a clashing meal and opening that day, nothing visible warns.

## Acceptance Criteria

Settle these four questions with the owner first, and record the answers under Updates:

- [x] Decided: which pick paths are covered. List every path that can add a plan item (recipe
      browser, suggested meal, featured recipe, the import paths, Simple Entry) and mark each
      covered or not, with the reason for any left out.
- [x] Decided: the warning lets the owner continue, or it blocks the add.
- [x] Decided: what the warning says and where it shows, including the "allergens not checked"
      case (a scanned item, or a recipe whose allergens are not derived yet).
- [x] Decided: whether who the meal is for is also shown at that point.

Then build it:

- [x] Picking a meal that clashes with the chosen eater's allergy shows the warning before the
      meal is added, on every covered path.
- [x] Picking a meal with no clash shows no warning.
- [x] The warning reaches VoiceOver and TalkBack users (announced, not only drawn).
- [x] Each covered path has a test that fails without the warning.
- [ ] The warning has been seen on the iOS simulator in light and dark.

## Implementation Notes

- Reuse the existing rule: `getEaters`, `getMealClashes` and `describeClash` in
  `client/components/meal-plan/family-utils.ts`. Do not write a second clash rule.
  `ALLERGENS_NOT_CHECKED` in the same file is the wording for the unknown case.
- Owner rulings that apply: ambiguous foods warn (the "possible" allergen level); family
  members' allergens are never sent to AI; restyle within `client/constants/theme.ts` tokens.
- A warning icon was drawn with Runware for the grid and then dropped with the grid mark. It is
  not in the repo. If this work wants an icon, draw one again or use the Feather
  `alert-triangle` the day screen already has.

## Scope Contract

- **Mechanisms to use:** the existing clash functions in `family-utils.ts`; the existing sheets
  and screens of the add flow.
- **Files in scope:** `client/hooks/useMealPlanSheets.tsx`, `client/components/meal-plan/**`,
  `client/screens/meal-plan/**`, and their tests. The exact list follows from the first
  criterion.
- No server change and no new clash rule.

## Dependencies

- The owner's answers to the four design questions.

## Risks

- The add flow has several entry points; one left uncovered would add a clashing meal silently.
- A recipe whose allergens are not derived yet cannot be checked at pick time; the warning must
  say so and not pass it as safe.

## Updates

### 2026-11-20

- Initial creation, from the owner's review of PR #1955.

### 2026-11-27 — owner's answers ("go with the recommendations")

1. **Paths:** all six that add a plan item are covered, each checking whoever the meal is for:
   - recipe browser: reads the recipe;
   - quick add: reads the recipe;
   - Simple Entry: no ingredients are kept, so it is never checkable and gets the note;
   - a suggested meal: its ingredients go through the same derivation the server runs on save;
   - the recipe wizard from the plan: checked on its ingredients before anything is saved;
   - the weekly report's "Add to my plan": reads the recipe.

   Not covered:
   - Saving a pantry-generated plan (`ReceiptMealPlanScreen`, `save-generated`) is a batch save that needs its own design. Filed as `todos/P3-2026-11-27-pantry-plan-save-has-no-allergen-check.md`.
   - The Coach's write cards add meals on the server, which is out of scope here (no server change).

   No other client code creates plan items: every other path goes through `useAddMealPlanItem` in the files above.

2. **Continue or block:** a clash warns and lets the user continue. A native alert reads "Allergy check", lists each clash, and asks "Add it to the plan anyway?", with Cancel and Add anyway; dismissing it cancels. A "possible" allergen warns too.
3. **Not checked:** the add goes ahead quietly, and the success toast ends ". Allergens not checked". This applies to a scanned item, a recipe not derived yet, a recipe with no ingredients, and a recipe that could not be read. It is never passed as safe.
4. **Who it is for:** each clash line names the eater ("Contains peanuts — Ivy"). There is no separate audience row.

With family planning off, the check still runs against the user's own allergies (raised in review). While those allergies are still loading, the add gets the "not checked" note.

### 2026-11-27 — built

- `client/components/meal-plan/pick-allergen-utils.ts` holds the check, on the existing `getEaters`, `getMealClashes` and `describeClash`. `client/hooks/useConfirmPlanPick.ts` shows the native alert, which VoiceOver and TalkBack announce and move focus to.
- Review fixes:
  - A family member missing from the app's list is not checked, never treated as safe.
  - Ingredient names have their spacing tidied the way the server does before it derives allergens.
  - The recipe read fails at once when offline instead of hanging.
  - `usePlanFamily` returns one object per change.
- Accepted: the check reads the add menu's choice and the add takes it. If that choice's 10-minute limit ran out while the alert was open, the add would go to the user's own plan.
- Found and filed: `todos/P2-2026-11-27-day-screen-passes-no-ingredient-recipe-as-allergen-safe.md`.
- Criterion 9 needs a person: seeing the warning on the iOS simulator in light and dark mode. It is a native system alert, so it follows the system theme. No simulator is available in this session.
