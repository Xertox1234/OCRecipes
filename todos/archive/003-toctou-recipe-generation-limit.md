---
title: "TOCTOU race on recipe generation daily limit"
status: backlog
priority: high
created: 2026-03-27
updated: 2026-03-27
assignee:
labels: [data-integrity, race-condition, audit-2026-03-27-full]
audit_id: H3
---

# TOCTOU race on recipe generation daily limit

## Summary

`server/routes/recipes.ts:262-327` checks the daily generation count then creates the recipe in separate operations without a transaction. Concurrent requests can both pass the limit check.

## Background

The count-then-check-then-insert pattern for rate limiting is used consistently across the codebase but none of these paths wrap the count+insert in a single transaction. The `createSavedItem` function in `nutrition.ts` is a good example of the correct pattern — it wraps the count check and insert in `db.transaction()`.

## Acceptance Criteria

- [ ] Count check and recipe creation wrapped in a `db.transaction()`
- [ ] Generation log insert is part of the same transaction
- [ ] Existing tests pass
- [ ] Test confirms concurrent requests cannot exceed the limit

## Implementation Notes

- Follow the `createSavedItem` pattern: wrap count + check + insert in `db.transaction(tx => { ... })`
- The transaction isolates the read-check-write sequence

## Dependencies

- None

## Risks

- Transaction may increase lock contention on the generation log table under high concurrency, but this is a low-QPS endpoint

## Updates

### 2026-03-27

- Created from full audit finding H3
