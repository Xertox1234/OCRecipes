---
title: "Add integration tests for saveRecipeFromChat storage function"
status: done
priority: high
created: 2026-05-09
updated: 2026-05-09
assignee:
labels: [deferred, testing, audit-2026-05-09]
---

# Add integration tests for saveRecipeFromChat storage function

## Summary

`saveRecipeFromChat` has 7 distinct exit paths but only 1 integration test (lineage happy path). 6 paths are uncovered, including the IDOR ownership guard and both idempotency paths.

## Background

Identified in the 2026-05-09 full audit (H9) by the testing-specialist agent. IDOR-sensitive storage functions require explicit test coverage of all guard paths per `docs/patterns/testing.md`.

## Acceptance Criteria

- [ ] Test: ownership check — `conversationId` owned by a different user returns `null`
- [ ] Test: missing or null metadata on message returns `null`
- [ ] Test: invalid Zod metadata (not `recipeChatMetadataSchema`) returns `null`
- [ ] Test: idempotency via `onConflictDoNothing` — calling twice with same `messageId` returns existing recipe
- [ ] Test: legacy `savedRecipeId` already in metadata returns existing recipe
- [ ] Test: `mealTypes` parameter is persisted on the created recipe
- [ ] All tests run against the real test DB (no mocking storage layer)

## Implementation Notes

Add tests in `server/storage/__tests__/chat.test.ts` under the existing `saveRecipeFromChat` describe block. The schema already has the partial unique index — tests relying on idempotency must use `.onConflictDoNothing()` (no target form, as fixed in C1).
