---
title: "Refresh today's totals when a Coach reply that logged food at once ends in a stream error"
status: backlog
priority: low
created: 2026-11-26
updated: 2026-11-26
assignee:
labels: [deferred, client]
github_issue:
---

# Refresh today's totals when a Coach reply that logged food at once ends in a stream error

## Summary

`CoachChat.tsx` refreshes the food log and daily summary queries when a reply
arrives carrying a food logged at once (`arrivedSavedRefreshKeys` in
client/lib/write-card-refresh.ts), but only in `onDone`. If the stream dies
after the server logged the food, the `onError` reconcile refetches the chat
messages only, so Home's totals stay stale until the next focus or refetch.

## Background

Found in the T2 mobile review. Coach roadmap T2 logs a small typed food during
the turn, so no Save tap runs the usual refresh.

## Acceptance Criteria

- [ ] After a stream error, if the refetched newest reply carries a saved
      `loggedAtOnce` food card, the same refresh keys are invalidated.
- [ ] A test of the pure helper covers the refetched-message case.
