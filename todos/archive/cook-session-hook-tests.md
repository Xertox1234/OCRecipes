---
title: "Add unit tests for useCookSession hooks"
status: done
priority: medium
created: 2026-03-09
labels: [testing, cook-and-track]
---

# Add unit tests for useCookSession hooks

## Summary

The `client/hooks/useCookSession.ts` file has TanStack Query mutation hooks (createSession, addPhoto, editIngredient, deleteIngredient, nutrition, logSession, recipe, substitutions) that need unit tests.

## Acceptance Criteria

- [x] Tests for `useCreateCookSession` hook
- [x] Tests for `useAddCookPhoto` hook
- [x] Tests for `useEditIngredient` hook
- [x] Tests for `useDeleteIngredient` hook
- [x] Tests for `useCookNutrition` hook
- [x] Tests for `useLogCookSession` hook
- [x] Tests for `useCookRecipe` hook
- [x] Tests for `useCookSubstitutions` hook
- [x] Tests for `useCookSessionQuery` hook

## Implementation Notes

- Test file: `client/hooks/__tests__/useCookSession.test.ts`
- Follow patterns in existing hook tests (e.g., `client/hooks/__tests__/`)
- Mock `apiRequest` from `@/lib/query-client`
- Use `renderHook` from `@testing-library/react-hooks` with QueryClient wrapper
