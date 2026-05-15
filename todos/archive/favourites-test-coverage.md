---
title: "Add test coverage for favourites system (storage, hooks, service)"
status: in-progress
priority: medium
created: 2026-04-09
updated: 2026-04-09
assignee:
labels: [testing, audit-9]
---

# Add test coverage for favourites system

## Summary

The favourites feature has route-level tests but is missing storage-layer tests, client hook mutation tests, suggestion-generation service tests, and a SuggestionParseError route test case.

## Background

Audit #9 findings M9, M10, M11, L13, L14. The storage module has complex transactional logic (toggle with advisory lock, unique constraint race handling, orphan cleanup) that is only indirectly tested via route mocks. The client hooks have optimistic updates, rollback, and LIMIT_REACHED alert handling that are untested.

## Acceptance Criteria

- [ ] `server/storage/__tests__/favourite-recipes.test.ts` — toggle transaction, orphan cleanup, limit enforcement, share payload access control
- [ ] `client/hooks/__tests__/useFavouriteRecipes.test.ts` — add tests for `useToggleFavouriteRecipe` (optimistic update, rollback, LIMIT_REACHED alert) and `useShareRecipe` (platform share, deep link)
- [ ] `server/services/__tests__/suggestion-generation.test.ts` — AI call construction, JSON parsing, `SuggestionParseError` handling
- [ ] Add `SuggestionParseError` error-path test case to `server/routes/__tests__/suggestions.test.ts`
- [ ] Create typed mock factories for `FavouriteRecipe` and `ResolvedFavouriteRecipe` in `server/__tests__/factories/`
