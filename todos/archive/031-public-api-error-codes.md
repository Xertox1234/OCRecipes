---
title: "Replace raw string error codes in public-api.ts with ErrorCode constants"
status: done
priority: low
created: 2026-03-29
updated: 2026-03-29
assignee:
labels: [code-quality, consistency]
---

# Replace raw string error codes in public-api.ts with ErrorCode constants

## Summary

`server/routes/public-api.ts` uses raw string literals (`"VALIDATION_ERROR"`, `"NOT_FOUND"`, `"INTERNAL_ERROR"`) in `sendError()` calls instead of the centralized `ErrorCode` constant from `@shared/constants/error-codes`. This was flagged during the full audit (Round 2) code review but was out of scope.

## Background

The audit standardized all ad-hoc error code strings across 5 route files (M6 finding) and migrated `admin-api-keys.ts` (L9 finding) to use `ErrorCode`. `public-api.ts` was not included because it was not flagged by the audit agents. The values happen to match, but the pattern diverges from the rest of the codebase.

## Acceptance Criteria

- [x] Import `ErrorCode` from `@shared/constants/error-codes` in `public-api.ts`
- [x] Replace all raw string error codes with `ErrorCode.X` equivalents
- [x] All existing tests pass

## Implementation Notes

Mechanical find-and-replace — same pattern as the L9 fix in `admin-api-keys.ts`.

## Dependencies

- None

## Risks

- None — values are identical, only the reference changes

## Updates

### 2026-03-30

- Resolved — all three acceptance criteria were already met. `ErrorCode` import and constants were in place from a prior audit fix. 17/17 tests pass.

### 2026-03-29

- Created from full audit Round 2 code review (L2 finding)
