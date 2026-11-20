---
title: "Warn about an allergen clash when a meal is picked for the plan"
status: backlog
priority: medium
created: 2026-11-20
updated: 2026-11-20
assignee:
labels: [deferred, client, meal-plan, family, allergens]
github_issue:
human_led: true
blocked_reason: "Needs the owner's answers to the four design questions under Acceptance Criteria before any code"
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

- [ ] Decided: which pick paths are covered. List every path that can add a plan item (recipe
      browser, suggested meal, featured recipe, the import paths, Simple Entry) and mark each
      covered or not, with the reason for any left out.
- [ ] Decided: the warning lets the owner continue, or it blocks the add.
- [ ] Decided: what the warning says and where it shows, including the "allergens not checked"
      case (a scanned item, or a recipe whose allergens are not derived yet).
- [ ] Decided: whether who the meal is for is also shown at that point.

Then build it:

- [ ] Picking a meal that clashes with the chosen eater's allergy shows the warning before the
      meal is added, on every covered path.
- [ ] Picking a meal with no clash shows no warning.
- [ ] The warning reaches VoiceOver and TalkBack users (announced, not only drawn).
- [ ] Each covered path has a test that fails without the warning.
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
