---
title: "Destructure stable .mutate from AdaptiveGoalCard mutation objects in useCallback deps"
status: backlog
priority: low
created: 2026-06-03
updated: 2026-06-03
assignee:
labels: [deferred, performance]
github_issue:
---

# Destructure stable .mutate from AdaptiveGoalCard mutation objects in useCallback deps

## Summary

`AdaptiveGoalCard` `handleAccept`/`handleDismiss` depend on full mutation result objects (`acceptMutation`, `dismissMutation`) — should destructure stable `mutate` ref. Full mutation objects re-create on every mutation-state change, piercing `React.memo`.

## Background

Deferred from 2026-06-03 full audit (L1). Confirmed by researcher: TanStack Query v5 `no-unstable-deps` ESLint rule explicitly flags this; docs show `mutate` is a stable `UseMutateFunction` reference. File: `client/components/AdaptiveGoalCard.tsx:96-114`.

## Acceptance Criteria

- [ ] `handleAccept` and `handleDismiss` deps use `acceptMutation.mutate` and `dismissMutation.mutate` (not the full objects)
- [ ] `isPending`/`isError` needed in render are destructured separately at the component level

## Implementation Notes

Pattern: `const { mutate: accept, isPending: acceptPending } = acceptMutation`. Use `accept` in `useCallback` dep array. Same for dismiss.

## Dependencies

- None

## Risks

- Low — stable ref substitution; behavior unchanged

## Updates

### 2026-06-03

- Initial creation (deferred from full audit L1)
