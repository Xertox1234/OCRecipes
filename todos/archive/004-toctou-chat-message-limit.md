---
title: "TOCTOU race on chat message daily limit"
status: backlog
priority: high
created: 2026-03-27
updated: 2026-03-27
assignee:
labels: [data-integrity, race-condition, audit-2026-03-27-full]
audit_id: H4
---

# TOCTOU race on chat message daily limit

## Summary

`server/routes/chat.ts:166-186` checks daily message count then creates the message in separate operations. Concurrent requests can bypass the daily limit.

## Background

Same TOCTOU pattern as H3 (recipe generation). The count is read at line 168, checked at line 173, and the message is created at line 186 — all outside a transaction.

## Acceptance Criteria

- [ ] Count check and message creation wrapped in a `db.transaction()`
- [ ] Existing tests pass

## Implementation Notes

- Same transactional pattern as H3
- Note: the `Promise.all` at line 184-191 fetches multiple things in parallel — the message creation needs to be separated from the parallel fetch and placed inside the transaction

## Dependencies

- None

## Risks

- None

## Updates

### 2026-03-27

- Created from full audit finding H4
