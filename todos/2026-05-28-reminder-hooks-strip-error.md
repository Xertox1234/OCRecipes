---
title: "Reminder hooks (useAcknowledgeReminders, usePendingReminders) strip error from their return"
status: backlog
priority: low
created: 2026-05-28
updated: 2026-05-28
labels: [deferred, hooks, client-state, error-handling]
github_issue:
---

# Reminder hooks (useAcknowledgeReminders, usePendingReminders) strip error from their return

## Summary

Two custom hooks wrap a query/mutation but omit `error`/`isError` from their return object, so no consumer can ever surface a failure. Same corrosive class as the filed `useProfileData`/`useHistoryData` todo, but lower blast radius — these drive a notification badge and a best-effort acknowledge, not core data.

## Background

Silent-failures audit cluster 4 (`docs/audits/2026-05-28-silent-failures.md`, findings **L9, L10**). Phase 2.5 research verdict: `confirmed` — v5 exposes `error`/`isError` as first-class returns and a wrapping hook that omits them makes the documented error-surfacing pattern structurally impossible. Low priority because the consequences are minor (an uncleared reminder badge / a silently-unacknowledged reminder), not data loss.

## Acceptance Criteria

- [ ] **L9** `useAcknowledgeReminders.ts:25-28` — return `isError`/`error` (and likely `isPending`) alongside `{ acknowledge, coachContext }`. Consumers `CoachProScreen` and `ChatListScreen` (the latter `.catch`-logs only) can then surface acknowledge failure if warranted.
- [ ] **L10** `usePendingReminders.ts:8,28` — expose `error` alongside `{ hasPending }` so the pending-reminders indicator can distinguish "no pending" from "query failed".
- [ ] Decide whether either consumer actually needs to render the error (badge-only surfaces may legitimately stay silent) — at minimum stop _structurally preventing_ it.

## Implementation Notes

- Mechanical: thread `isError`/`error` through each hook's return. Use `findReferences` (LSP) on each hook before changing its return shape to find all consumers (resolves `@/` aliases).
- This is low-severity and disposable — boilerplate-eligible. The bar is "stop hiding the error", not necessarily "build error UI" if the consumer is a non-critical badge.

## Dependencies

- Sibling of `todos/2026-05-28-data-hooks-hide-query-error.md` (same class, higher-impact hooks).

## Risks

- Low. Additive to return objects; watch for consumers that spread the hook return into props.

## Updates

### 2026-05-28

- Created from silent-failures audit (themed-by-cluster triage). Both return shapes read against source.
