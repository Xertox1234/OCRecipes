---
title: "Query-consumer screens/components hide query errors as empty/null/default (incl. confident-wrong data)"
status: backlog
priority: high
created: 2026-05-28
updated: 2026-05-28
assignee:
labels: [react-native, client-state, error-handling]
github_issue:
---

# Query-consumer screens/components hide query errors as empty/null/default (incl. confident-wrong data)

## Summary

Nineteen screens/components call `useQuery` (directly or via a hook), destructure only `{ data, isLoading }`, never read `error`/`isError`, and on failure render an empty state, `return null`, or substitute a default value. The worst sub-cases present **confident wrong data**, not just blanks.

## Background

Silent-failures audit cluster 2 (`docs/audits/2026-05-28-silent-failures.md`, findings **H5–H8, M1–M11, L1–L4**). The app has no global query error net, so each screen must surface its own errors and these don't. Phase 2.5 research (TanStack Query v5) verdict: `better-fix` — per-screen `isError` rendering is valid for _contextual_ error UI, but the v5-recommended backstop is the already-filed global `QueryCache.onError` (`todos/2026-05-28-global-query-error-handler.md`) + optionally `throwOnError`/ErrorBoundary for empty-cache failures. **Bundling this with the global-handler todo is worth considering** — the global net covers most of these app-wide, leaving only per-section retry UX here.

## Acceptance Criteria

**High (confident-wrong-data / safety first):**

- [ ] **H8** `RecipeDetailContent.tsx:153` (`useAllergenCheck`) — read the error; do NOT silently drop the `AllergenWarningBanner` (rendered via `client/components/recipe-detail/RecipeIngredientsList.tsx`) on a failed check. **Safety:** a declared-allergy user must not see "no warning" when the check merely failed.
- [ ] **H6** `MealPlanHomeScreen.tsx:505,587-588` — surface read errors; stop rendering the calorie ring against `calorieGoal ?? 2000` when the budget fetch failed.
- [ ] **H7** `useFastingTimer.ts:79-90` — surface errors; a mid-fast user must not see the idle "start a fast" screen because `currentFast` failed to load.
- [ ] **H5** `WeightTrackingScreen.tsx:66-67` — surface read errors and add a retry/refresh path (screen currently has none).

**Medium (empty-vs-error):**

- [ ] **M1–M11** distinguish error-empty from genuine-empty in: `GroceryListsScreen.tsx:39`, `PantryScreen.tsx:141`, `CookbookListScreen.tsx:30`, `CookbookDetailScreen.tsx:41`, `GLP1CompanionScreen.tsx:57`, `FavouriteRecipesScreen.tsx:35`, `SavedItemsScreen.tsx:112` (also the confident-wrong "0/N" header count), `CookbookPickerModal.tsx:51`, `GroceryListPickerModal.tsx:50`, `QuickAddSheet.tsx:91`, `CoachProScreen.tsx:55`.

**Low:**

- [ ] **L1–L4** `GroceryListScreen.tsx:199` (wrong "not found" on transient error + no retry on failed initial load), `HighProteinSuggestions.tsx:19`, `QuickLogScreen.tsx:67`, `CookbookCreateScreen.tsx:52` (edit-mode empty form on load failure → overwrite risk).

## Implementation Notes

- For each: read `isError`/`error` from the query (or thread it through the wrapping hook — some hooks may strip it; check `useFastingTimer`, `useWeightLogs`, etc.) and render an error+retry, distinct from the empty state.
- **Genuine-empty-vs-error caveat is critical here:** lists/cookbooks/pantry/favourites all have legitimate first-run empty states. The fix MUST differentiate true-empty (200 empty payload) from error-empty, or a fresh user sees a false error.
- Strongly consider doing the filed `QueryCache.onError` global-handler todo first/together — it's the highest-leverage single change and covers most of these as a backstop, reducing this to per-section retry affordances on the high-value screens (H5–H8).
- `DiscoveryCarousel` is NOT in scope here — it's already covered by `todos/2026-05-28-home-screen-silent-query-failure.md`.

## Dependencies

- Companion to `todos/2026-05-28-global-query-error-handler.md` (backstop) — consider bundling.

## Risks

- Mislabeling a legitimate empty state as an error (see caveat). Test fresh-user paths.

## Updates

### 2026-05-28

- Created from silent-failures audit (themed-by-cluster triage). High findings re-read against source; Medium/Low carry the discovering agent's file:line citations.
