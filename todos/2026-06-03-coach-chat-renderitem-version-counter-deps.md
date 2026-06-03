---
title: "CoachChat renderItem version counter deps defeat FlatList memoization"
status: backlog
priority: low
created: 2026-06-03
updated: 2026-06-03
assignee:
labels: [deferred, performance]
github_issue:
---

# CoachChat renderItem version counter deps defeat FlatList memoization

## Summary

`CoachChat.renderItem` includes `quickReplyVersion`/`commitmentVersion` integer counters in its `useCallback` deps, so every quick-reply tap creates a new `renderItem` ref, invalidating all FlatList item caches and defeating `React.memo` on `ChatBubble`/`BlockRenderer`.

## Background

Deferred from 2026-06-03 full audit (M2). Confirmed by researcher: React Compiler still produces a new ref when deps genuinely change — the version counter churn is a real issue. File: `client/components/coach/CoachChat.tsx:520-535`.

## Acceptance Criteria

- [ ] `renderItem` ref is stable across version counter bumps
- [ ] Quick-reply selection still triggers the appropriate re-render for only the affected item
- [ ] No visible regression in chat bubble rendering

## Implementation Notes

Options: (1) move version counter logic into item-level state rather than a parent counter, (2) use `useRef` for the counters and read them inside the callback via the ref pattern, (3) move version-sensitive rendering inside the item component. Avoid passing the counter directly as a dep to `useCallback`.

## Dependencies

- None

## Risks

- Chat interaction timing; ensure quick-reply selection is not delayed

## Updates

### 2026-06-03

- Initial creation (deferred from full audit M2)
