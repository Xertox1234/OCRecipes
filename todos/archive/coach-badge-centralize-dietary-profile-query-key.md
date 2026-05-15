---
title: "Centralize /api/user/dietary-profile query key to prevent drift"
status: done
priority: medium
created: 2026-05-01
updated: 2026-05-01
assignee:
labels: [dx, client, tanstack-query, coach-badge]
---

# Centralize /api/user/dietary-profile query key to prevent drift

## Summary

The `["/api/user/dietary-profile"]` TanStack Query key is duplicated as an inline string array in at least three files. If any one copy drifts (e.g., after a route rename), invalidations from one screen won't affect caches in others, causing silent stale-data bugs.

## Background

Current duplicates:

- `client/screens/CoachRemindersScreen.tsx` — `DIETARY_PROFILE_KEY` module-local const
- `client/screens/RecipeChatScreen.tsx:108` — inline `["/api/user/dietary-profile"]`
- `client/hooks/useDietaryProfileForm.ts:51` — inline `["/api/user/dietary-profile"]`

The project convention (see `docs/patterns/hooks.md`) is to use the fetch URL as the query key, but shared keys used across multiple files should be lifted to a central constant map to make global invalidation unambiguous.

## Acceptance Criteria

- [ ] A shared `QUERY_KEYS.dietaryProfile` constant is added (e.g., in `client/lib/query-keys.ts` or alongside existing key constants)
- [ ] All three inline `["/api/user/dietary-profile"]` occurrences are replaced with the shared constant
- [ ] `queryClient.invalidateQueries` and `setQueryData` callers are updated to use the shared constant
- [ ] No behavior change — all tests still pass

## Implementation Notes

Check if a `QUERY_KEYS` map already exists (grep for `QUERY_KEYS` in `client/`). If so, add `dietaryProfile` there. If not, create `client/lib/query-keys.ts`:

```ts
export const QUERY_KEYS = {
  dietaryProfile: ["/api/user/dietary-profile"] as const,
} as const;
```

## Dependencies

- None

## Risks

- Trivial — constant extraction only, no logic changes

## Updates

### 2026-05-01

- Identified during code review of coach-badge todo session
