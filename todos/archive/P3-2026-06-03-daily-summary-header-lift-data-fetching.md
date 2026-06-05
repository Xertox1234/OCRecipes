---
title: "Lift useDailyBudget out of DailySummaryHeader into HomeScreen"
status: done
priority: low
created: 2026-06-03
updated: 2026-06-03
assignee:
labels: [deferred, performance]
github_issue:
---

# Lift useDailyBudget out of DailySummaryHeader into HomeScreen

## Summary

`DailySummaryHeader` currently calls `useDailyBudget` internally, which means it re-renders on every TanStack Query cache invalidation regardless of the `React.memo` wrapper added in PR #350. Lifting the fetch to the parent and passing `budget`/`isLoading`/`isError`/`refetch` as props would make `React.memo` genuinely effective as a `ListHeaderComponent`.

## Background

PR #350 wrapped `DailySummaryHeader` in `React.memo` to align it with sibling carousel components. However, `HomeScreen` already calls `useDailyBudget` itself (`client/screens/HomeScreen.tsx:84`), and `DailySummaryHeader` also calls it internally (`client/components/home/DailySummaryHeader.tsx:30`). Both independently subscribe to the same query cache, so whenever a meal log or barcode scan invalidates the budget cache, _both_ re-render from their own subscriptions — `React.memo` is bypassed entirely because the re-render is hook-driven, not prop-driven. Lifting the fetch makes memo effective: the child re-renders only when the passed props actually change.

## Acceptance Criteria

- [ ] `DailySummaryHeader` no longer calls `useDailyBudget` directly
- [ ] `DailySummaryHeader` props interface extended: `budget`, `isLoading`, `isError`, `refetch` (mirroring the existing destructure at `DailySummaryHeader.tsx:30-35`)
- [ ] `HomeScreen` passes those values from its existing `useDailyBudget` call (no second network call added)
- [ ] The `meta: { silentError: true }` option stays on the HomeScreen-level call (it must match the comment at `HomeScreen.tsx:75-78`)
- [ ] `React.memo` wrapper from PR #350 is retained
- [ ] No visual regression in the greeting row or calorie summary tap

## Implementation Notes

**Files in scope:**

- `client/components/home/DailySummaryHeader.tsx` — remove `useDailyBudget` import and call; update `DailySummaryHeaderProps`
- `client/screens/HomeScreen.tsx` — pass `budget`, `isLoading`, `isError`, `refetch` to `<DailySummaryHeader>`

**Current HomeScreen destructure (line 84):**

```ts
const {
  data: budget,
  isLoading,
  isError,
  refetch,
} = useDailyBudget(undefined, { meta: { silentError: true } });
```

These four values can be forwarded directly as props — no new query needed.

**`CarouselError` retry handler** in `DailySummaryHeader` is `() => void refetch()` — once `refetch` is a prop the pattern is identical, just sourced externally.

## Dependencies

- PR #350 must be merged first (adds the `React.memo` wrapper this todo improves)

## Risks

- Low risk — pure refactor, no logic change
- Verify that the `meta: { silentError: true }` comment/intent is preserved at the HomeScreen call site (both components previously opted out of global error toasts for the same query)

## Updates

### 2026-06-03

- Initial creation — deferred from PR #350 review
