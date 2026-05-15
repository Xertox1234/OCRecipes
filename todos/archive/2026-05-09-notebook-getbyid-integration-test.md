---
title: "Add storage-level integration test for getNotebookEntryById"
status: done
priority: medium
created: 2026-05-09
updated: 2026-05-09
assignee:
labels: [deferred, testing, security, audit-2026-05-09]
---

# Add storage-level integration test for getNotebookEntryById

## Summary

`getNotebookEntryById(id, userId)` was added in commit b03a4c86 but has no storage-level integration test. The function is IDOR-sensitive — the wrong-user case (returns undefined) is only verified via a mock in the route test.

## Background

Identified in the 2026-05-09 full audit (M5) by the testing-specialist agent. Route-level mocks don't verify DB-level ownership filtering. Per `docs/patterns/testing.md`, IDOR-sensitive storage functions require integration tests verifying the ownership guard.

## Acceptance Criteria

- [ ] Happy path: owned entry is returned with correct fields
- [ ] IDOR path: entry owned by a different user returns `undefined`
- [ ] Non-existent ID returns `undefined`
- [ ] Tests run against the real test DB

## Implementation Notes

Add tests to `server/storage/__tests__/coach-notebook.test.ts` under a `getNotebookEntryById` describe block.
