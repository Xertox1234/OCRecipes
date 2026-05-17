---
title: "Expose 'Online (Spoonacular)' source option in recipe search filter"
status: backlog
priority: medium
created: 2026-05-16
updated: 2026-05-17
assignee:
labels: [deferred, api]
github_issue:
---

# Expose 'Online (Spoonacular)' source option in recipe search filter

## Summary

`SearchFilterSheet` has a commented-out `{ value: "spoonacular", label: "Online" }` source option. This todo wires that option up so selecting "Online" surfaces Spoonacular results in the recipe browser.

## Background

Surfaced by the 2026-05-16 unfinished-features audit (finding M4). Originally deferred because the local search service (`server/services/recipe-search.ts`) only filters locally-stored recipes, so a `source: "spoonacular"` value would match nothing.

**Re-scoped 2026-05-17:** a complete Spoonacular search endpoint already exists — `GET /api/meal-plan/catalog/search` (`server/routes/recipe-catalog.ts`): premium-gated via `checkPremiumFeature("catalogSave", ...)`, rate-limited (`mealPlanRateLimit`), quota-aware (throws `CatalogQuotaError` → 402), and it already injects the user's allergens as Spoonacular `intolerances`. There is no need to integrate Spoonacular into `recipe-search.ts`.

## Design decisions (resolved 2026-05-17 — do NOT re-litigate)

1. **Merge strategy: mode switch.** When the user selects source = "Online", the recipe browser calls the existing `/api/meal-plan/catalog/search` endpoint instead of the local recipe search. Results render in the same list UI. `server/services/recipe-search.ts` is NOT modified. The "All" source stays local-only — it does not merge in Spoonacular results.
2. **Premium UX: show with upgrade prompt.** The "Online" option is visible to all users in `SOURCE_OPTIONS`. When a free user selects it, surface the existing premium-upgrade prompt used for other catalog features. Do not hide the option for free users.

## Acceptance Criteria

- [ ] Add `{ value: "spoonacular", label: "Online" }` to `SOURCE_OPTIONS` in `client/components/meal-plan/SearchFilterSheet.tsx` (replacing the TODO at line ~47). Confirm the `SourceOption` type already includes `"spoonacular"`; add it if not.
- [ ] In `client/screens/meal-plan/RecipeBrowserScreen.tsx`, when the active source is `"spoonacular"`, route the search request to `GET /api/meal-plan/catalog/search` instead of the local recipe search endpoint. Results render in the existing list.
- [ ] When a free (non-premium) user selects the "Online" source, show the existing premium-upgrade prompt used for catalog features (reuse the established pattern — do not invent a new one). Premium users proceed straight to the search.
- [ ] Handle the catalog endpoint's pagination/loading model — it uses Spoonacular's own offset/number paging, which differs from local search. Wire the browser screen's load-more behavior to the catalog response shape when in "Online" mode.
- [ ] Handle the `402 CATALOG_QUOTA_EXCEEDED` response gracefully — show a clear "online search is temporarily unavailable" message rather than a generic error.
- [ ] Tests: source-routing logic (online vs local), the free-user upgrade-prompt branch, and quota-exceeded handling.

## Implementation Notes

- TODO marker: `client/components/meal-plan/SearchFilterSheet.tsx:47`.
- Catalog endpoint: `GET /api/meal-plan/catalog/search` — already premium-gated, rate-limited, quota-aware, allergen-aware. Reuse as-is; do not duplicate or re-integrate.
- The `RecipeSearchParams.source` union in `shared/types/recipe-search.ts` already includes `"spoonacular"`.
- Spoonacular recipes use `spoonacular:<id>` document IDs in `SearchableRecipe` — keep result shapes consistent so the existing list/detail navigation works.
- Premium status is available client-side via the subscription/premium context — check it before calling, or detect the gate response; reuse the existing catalog upgrade-prompt component.
- **Merge ordering (not a code dependency):** this todo edits `client/screens/meal-plan/RecipeBrowserScreen.tsx`, which PR #211 (recipe-search allergen filter) also modifies. A small mechanical merge conflict in that file is expected. The mode-switch design does NOT require PR #211's code — resolve the conflict at merge time by merging PR #211 first.

## Dependencies

- Spoonacular API quota (operational, not a blocking todo).
- No blocking todo dependencies. The `RecipeBrowserScreen.tsx` overlap with PR #211 is a merge-ordering concern (see Implementation Notes), not an execution blocker.

## Risks

- External API latency on "Online" searches; mitigated by it being an explicit opt-in mode, not the default.

## Updates

### 2026-05-16

- Initial creation (audit 2026-05-16-unfinished-features, finding M4)

### 2026-05-17

- Re-spec'd to implementation-ready. Confirmed the catalog Spoonacular endpoint already exists fully gated. Design decisions resolved with the user: mode switch (no `recipe-search.ts` changes), "Online" option shown to all with an upgrade prompt for free users.
