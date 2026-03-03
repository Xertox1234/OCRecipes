---
title: "Extract shared query keys and fix isFavourited type"
status: backlog
priority: medium
created: 2026-02-27
updated: 2026-02-27
assignee:
labels: [consistency, client, type-safety, pr-10-review]
---

# Extract Shared Query Keys and Fix isFavourited Type

## Summary

Two client-side issues: (1) `useFavourites.ts` and `useDiscardItem.ts` hardcode the query key `["/api/scanned-items"]` — if the key changes, optimistic updates silently break. (2) `isFavourited` is typed as optional (`?`) when the server always returns it, forcing defensive `?? false` checks.

## Issue 1: Hardcoded Query Keys

**Files:** `client/hooks/useFavourites.ts`, `client/hooks/useDiscardItem.ts`

Both hooks hardcode:
```typescript
queryClient.cancelQueries({ queryKey: ["/api/scanned-items"] });
queryClient.getQueryData(["/api/scanned-items"]);
```

If `HistoryScreen` ever adds filter params to the query key, these hooks silently stop performing optimistic updates.

**Fix:** Extract to a shared constant:
```typescript
// client/lib/query-keys.ts
export const QUERY_KEYS = {
  scannedItems: ["/api/scanned-items"] as const,
  dailySummary: ["/api/daily-summary"] as const,
} as const;
```

## Issue 2: Optional isFavourited Type

**File:** `client/types/api.ts:27`

```typescript
isFavourited?: boolean;  // Should be: isFavourited: boolean;
```

The server always returns this field on list and detail endpoints. Making it required eliminates defensive `?? false` checks and provides compile-time safety.

## Acceptance Criteria

- [ ] `QUERY_KEYS` constant exported from `client/lib/query-keys.ts`
- [ ] Both mutation hooks use `QUERY_KEYS.scannedItems` instead of hardcoded string
- [ ] `HistoryScreen` query uses the same constant
- [ ] `isFavourited` changed from optional to required in `ScannedItemResponse`
- [ ] All `?? false` fallbacks removed
- [ ] All existing tests pass

## Dependencies

- None

## Risks

- Changing `isFavourited` to required may surface type errors if any code path constructs a `ScannedItemResponse` without it

## Updates

### 2026-02-27
- Created from PR #10 code review (found by architecture-strategist, pattern-recognition-specialist)
