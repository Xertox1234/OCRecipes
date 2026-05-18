---
title: "Validate recipe-search hook responses with Zod schemas"
status: done
priority: low
created: 2026-05-17
updated: 2026-05-17
assignee:
labels: [deferred, client-state, typescript]
github_issue:
---

# Validate recipe-search hook responses with Zod schemas

## Summary

`useRecipeSearch` and `useCatalogSearch` both call `res.json()` and trust the
response shape implicitly. Add Zod `safeParse` validation at the network
boundary so server contract drift surfaces as a structured error instead of a
silent `undefined` downstream.

## Background

Surfaced as a WARNING during code review of the 2026-05-16 Spoonacular search
todo. The new `useCatalogSearch` hook (and the pre-existing `useRecipeSearch`)
type their responses with TypeScript interfaces only — there is no runtime
validation. If the server renames a field (e.g. `results` → `items`), the hook
returns `undefined` data and the mapping layer throws at render time with no
clear cause.

Deferred because adding validation to only the new hook would diverge from its
sibling `useRecipeSearch`. This is a project-wide consistency change that
should land across both hooks together, not a one-off.

## Acceptance Criteria

- [ ] Define a Zod schema for the local recipe-search response shape
      (`RecipeSearchResponse`) and validate it inside `useRecipeSearch`.
- [ ] Define a Zod schema for the catalog search response shape and validate
      it inside `useCatalogSearch`.
- [ ] On `safeParse` failure, throw a structured error (not a silent
      `undefined`) so TanStack Query surfaces it via `error`.
- [ ] Tests covering the parse-failure path for both hooks.

## Implementation Notes

- Files in scope: `client/hooks/useRecipeSearch.ts`,
  `client/hooks/useCatalogSearch.ts`.
- `shared/types/recipe-search.ts` already defines the response interfaces —
  derive or mirror the Zod schemas from those.
- The catalog response shape (`{ results, offset, number, totalResults }`)
  matches the server's `catalogSearchResponseSchema` in
  `server/services/recipe-catalog.ts` — consider sharing one schema if it can
  be moved to `shared/`.

## Dependencies

- No blocking dependencies.

## Risks

- Low. Purely additive runtime validation; no behavior change on the happy
  path.

## Updates

### 2026-05-17

- Initial creation (deferred WARNING from code review of
  `2026-05-16-recipe-search-spoonacular-source.md`)
