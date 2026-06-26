---
title: "Dedupe cuisine list between RecipeDiscoveryFeed and RecipeBrowserScreen"
status: backlog
priority: low
created: 2026-06-25
updated: 2026-06-25
assignee:
labels: [deferred, ui]
github_issue:
---

# Dedupe cuisine list between RecipeDiscoveryFeed and RecipeBrowserScreen

## Summary

`RecipeDiscoveryFeed.tsx` re-declares a local `CUISINES` array that is a verbatim
duplicate of `CUISINE_PRESETS` in `RecipeBrowserScreen.tsx`. The two should share a
single source so the lists cannot silently diverge.

## Background

Surfaced in the whole-branch review of the Discover + Search redesign (Phases 1-2,
range 06f2c40f..efe31a9d). Both arrays currently hold the identical six values in the
same order (`Italian, Mexican, Asian, Mediterranean, American, Indian`), so there is
no behavioral bug today. The risk is latent drift: a future edit to one list (e.g.
adding "French") would leave the feed's "Browse by cuisine" chips out of sync with the
screen's pinned filter-chip row, and both render at the same time during the blank
browse state. Low severity because both chip sets route to the same
`handleToggleCuisine` handler and the values match at merge time.

## Acceptance Criteria

- [ ] A single canonical cuisine-preset list is the source of truth (e.g. exported
      from `client/screens/meal-plan/recipe-browser-utils.ts` or a shared constants
      module).
- [ ] `RecipeDiscoveryFeed.tsx` imports that list instead of declaring a local
      `CUISINES` array.
- [ ] `RecipeBrowserScreen.tsx` `CUISINE_PRESETS` references the same canonical list.
- [ ] Behavior unchanged: blank-state cuisine chips still toggle `activeCuisine` via
      `handleToggleCuisine`.

## Implementation Notes

- Duplicate lists:
  - `client/components/meal-plan/RecipeDiscoveryFeed.tsx` (local `const CUISINES`).
  - `client/screens/meal-plan/RecipeBrowserScreen.tsx` (`const CUISINE_PRESETS`, ~line 87).
- `CUISINE_PRESETS` lives at module scope in the screen file; extracting it to
  `recipe-browser-utils.ts` (already imported by the screen) is the lowest-churn move.
- While here, consider whether the feed's "Browse by cuisine" section is redundant
  given the screen already renders the same cuisine chips in the pinned filter row
  during the blank state — but that is a UX decision, out of scope for the pure dedupe.

## Dependencies

- None.

## Risks

- None material; pure refactor with no schema or API impact.

## Updates

### 2026-06-25

- Initial creation (deferred from Discover + Search redesign whole-branch review, T6).
