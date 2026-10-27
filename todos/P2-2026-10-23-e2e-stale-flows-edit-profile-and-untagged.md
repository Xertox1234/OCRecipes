---
title: "E2E: fix edit-profile's stale tile assertions (nightly red since 10-20) and the five stale untagged flows"
status: in-progress
priority: medium
created: 2026-10-23
updated: 2026-10-23
assignee:
labels: [deferred, testing]
github_issue:
---

# E2E: fix edit-profile's stale tile assertions and the five stale untagged flows

## Summary

The nightly `e2e-regression.yml` has failed every night since at least
2026-10-20 on one flow, `e2e/flows/profile/edit-profile.yaml`, on both
iOS and Android. Five more flows that carry no `regression` tag (so CI never
runs them) no longer match the UI.

## Background

Found while checking SDK step 1 (Expo SDK 55) against main's nightly. None
of this is caused by the SDK upgrade: the same flows fail the same way on
SDK 54.

- `edit-profile.yaml:36` asserts `"Recipes: \d+ items.*"`. ProfileCard's
  tile is now "Recipe Catalog", so the label is `"Recipe Catalog: 27 items"`.
- `edit-profile.yaml:35` asserts `"Favourites: \d+ items.*"`. The label is
  singular when the count is 1 (`"Favourites: 1 item"`), so it fails for
  any account with exactly one favourite. Seen with the local demo account.
  The CI account happens to have a different count.
- Untagged flows, last touched 2026-08-16 or earlier, fail against the
  current UI:
  - `home/exercise-log.yaml`: there is no "Exercise" label on Home.
  - `profile/goal-setup.yaml`: "Nutrition Goals" now lives in
    `client/screens/SettingsScreen.tsx`, not on Profile.
  - `plan/import-recipe.yaml`, `plan/browse-recipes.yaml`,
    `plan/create-recipe.yaml`: `tapOn "Recipes"` is not found, although
    the Plan screen shows a "Recipes" chip
    (`client/screens/meal-plan/MealPlanHomeScreen.tsx:1434`). Check the
    chip's accessibility label in a `maestro hierarchy` dump.

## Acceptance Criteria

- [ ] `edit-profile.yaml` asserts the current tile labels and accepts both
      "item" and "items" (e.g. `"Favourites: \d+ items?.*"`).
- [ ] The nightly passes 10/10 on both platforms.
- [ ] Each of the five untagged flows is either rewritten from a live
      hierarchy and tagged `regression`, or deleted. Decide per flow.

## Implementation Notes

Rewrite selectors from a `maestro hierarchy` dump, as #1022 did for
edit-profile. Run locally with a FREE-tier account, as CI uses: the local
`demo` account is premium, so `chat.yaml` and `navigate-tabs.yaml` fail
on "NutriCoach" with it (premium lands on the Coach thread, not the chat
list). An `e2etest_*` user that the onboarding flow registered (password
`TestPassphrase123!`) works. Judge screens with `xcrun simctl io … screenshot`, not
Maestro alone.

## Scope Contract

- **Mechanisms to use:** existing Maestro helpers in `e2e/helpers/`.
- **Files in scope:** `e2e/flows/**`.
- No new mechanisms, files, or abstractions beyond those listed.

## Updates

### 2026-10-23

- Initial creation (from the SDK 55 upgrade check, PR for
  `chore/sdk-step1-sdk55`).
