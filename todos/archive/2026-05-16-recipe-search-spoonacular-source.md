---
title: "Expose 'Online (Spoonacular)' source option in recipe search filter"
status: done
priority: medium
created: 2026-05-16
updated: 2026-05-17
assignee:
labels: [deferred, api]
github_issue:
---

# Expose 'Online (Spoonacular)' source option in recipe search filter

## Summary

`SearchFilterSheet` has a commented-out `{ value: "spoonacular", label: "Online" }` source option. The TODO says to add it "when Spoonacular inline integration lands". Spoonacular results currently cannot be surfaced through the in-app recipe search filter.

## Background

Surfaced by the 2026-05-16 unfinished-features audit (finding M4, product-completeness). Deferred from the fix phase because it requires backend feature work: the local recipe search service (`server/services/recipe-search.ts`) filters `r.source === source` against locally-stored recipes only. Spoonacular recipes come from an external API call, not the local DB, so a `source: "spoonacular"` filter value would match nothing until search can call Spoonacular inline and merge results.

## Acceptance Criteria

- [ ] Decide how Spoonacular results are fetched and merged into the unified search result set
- [ ] Implement the inline Spoonacular search path
- [ ] Uncomment / add `{ value: "spoonacular", label: "Online" }` to `SOURCE_OPTIONS` in `client/components/meal-plan/SearchFilterSheet.tsx`
- [ ] Handle pagination/loading differences between local and external results
- [ ] Tests

## Implementation Notes

- TODO marker: `client/components/meal-plan/SearchFilterSheet.tsx:47`.
- Spoonacular integration already exists for the catalog path (`server/routes/recipe-catalog.ts`, `server/services/recipe-catalog.ts`) — reuse rather than re-integrate.
- Consider rate-limit / quota cost of calling Spoonacular on every search.

## Dependencies

- Spoonacular API quota
- Decision on result-merging strategy with local search

## Risks

- External API latency degrades the search experience if not handled async.

## Updates

### 2026-05-16

- Initial creation (audit 2026-05-16-unfinished-features, finding M4)
