---
title: "Coach Pro: Write meaningful storage tests for coach-notebook"
status: in-progress
priority: medium
created: 2026-04-10
updated: 2026-04-10
assignee:
labels: [coach-pro, testing, server]
---

# Coach Pro: Write meaningful storage tests for coach-notebook

## Summary

The current `server/storage/__tests__/coach-notebook.test.ts` has 8 tests, but 7 only verify `typeof fn === 'function'`. They provide near-zero coverage of actual query logic — filtering by userId, status updates, archival, follow-up date queries.

## Background

Other storage modules in the project have integration tests that use a test database transaction pattern. The notebook storage should follow the same approach for meaningful coverage.

## Acceptance Criteria

- [ ] Test `getActiveNotebookEntries` filters by userId and active status
- [ ] Test `getActiveNotebookEntries` with type filter
- [ ] Test `createNotebookEntry` creates and returns an entry
- [ ] Test `updateNotebookEntryStatus` changes status and updatedAt
- [ ] Test `getCommitmentsWithDueFollowUp` returns only due commitments
- [ ] Test `archiveOldEntries` archives entries older than threshold
- [ ] Test `getNotebookEntryCount` counts by type and status

## Implementation Notes

- Follow the pattern in other storage test files that use real DB transactions
- These tests will be in the `server/storage/__tests__/` directory which is excluded from `test:unit` — they run via `test:run` with a database connection
