---
title: "Replace manual catch blocks in photos.ts with canonical handleRouteError"
status: done
priority: low
created: 2026-06-03
updated: 2026-06-03
assignee:
labels: [deferred, architecture]
github_issue:
---

# Replace manual catch blocks in photos.ts with canonical handleRouteError

## Summary

`photos.ts` has 4 catch blocks using manual `logger.error` + `sendError` instead of the canonical `handleRouteError(res, error, "context")` helper. This misses automatic `ZodError → 400` handling that the helper provides.

## Background

Deferred from 2026-06-03 full audit (L7). File: `server/routes/photos.ts:290-297,363-369,455-462,547-553`. All 4 catch blocks are direct manual error handling.

## Acceptance Criteria

- [ ] All 4 catch blocks replaced with `handleRouteError(res, error, "context string")`
- [ ] Zod validation errors in photo processing now return 400 automatically
- [ ] No regression in photo upload error handling

## Implementation Notes

Import `handleRouteError` from `../_helpers` (or wherever it's defined in the routes layer). Replace each `logger.error(...)` + `sendError(...)` pair with a single `handleRouteError(res, error, "upload" | "analysis" | etc)` call.

## Dependencies

- None

## Risks

- Response format change for Zod errors (now 400 instead of 500) — test with malformed payloads

## Updates

### 2026-06-03

- Initial creation (deferred from full audit L7)
