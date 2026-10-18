---
title: "Inspired-suggestions storage tests break on any real expired card in the dev DB"
status: backlog
priority: low
created: 2026-10-17
updated: 2026-10-17
assignee:
labels: [deferred, testing]
github_issue:
---

# Inspired-suggestions storage tests break on any real expired card in the dev DB

## Summary

Three tests in `server/storage/__tests__/inspired-suggestions.test.ts` assert on the WHOLE result of `listExpiredUnmadeSuggestions(new Date(), 100)`, so any real expired, unmade card committed in the shared dev database (from sim or dev use) makes them fail.

## Background

Found during the spice-level todo (2026-10-17): dev-DB row 798, an idea card created and expired the same evening by a dev session, appeared in the list (`expected [ 798, 973 ] to deeply equal [ 973 ]`). The pre-push gate failed on these tests and blocked PR creation for an unrelated change. CI uses a fresh database, so it passes there. Same class as `docs/solutions/logic-errors/rolled-back-test-transaction-still-sees-committed-rows-2026-10-17.md`: a rolled-back test transaction still sees rows other sessions committed.

## Acceptance Criteria

- [ ] The tests at lines ~168, ~179 and ~192 assert only on the ids they created (filter the listed ids to the test's own rows, or check membership/absence of their own ids)
- [ ] The "never lists a claimed card" test checks its own card is absent rather than `toEqual([])`
- [ ] The tests pass with an unrelated expired, unmade row present in the dev DB

## Implementation Notes

- File: `server/storage/__tests__/inspired-suggestions.test.ts` only. Do not change `listExpiredUnmadeSuggestions` or delete dev-DB rows.
