---
title: "Auth integration test harness: minor scaling/docs follow-ups"
status: done
priority: low
created: 2026-07-12
updated: 2026-07-12
assignee:
labels: [deferred, testing, server]
github_issue:
---

# Auth integration test harness: minor scaling/docs follow-ups

## Summary

Dual review (server-reviewer + security-auditor) of PR #594 (real-DB HTTP integration test
harness for auth routes) found the harness itself sound — real transaction rollback, correct
mock scoping, genuine revocation-scenario coverage, no auth-bypass surface introduced, clean
test-credential hygiene. Two minor, non-blocking notes surfaced for future maintainers.

## Background

Both findings were SUGGESTION-tier / informational — reviewers gave an unqualified
MERGE-READY. Filed during the "review, fix, codify, close all open PRs" session, 2026-07-12.

## Acceptance Criteria

- [x] If this `.itest.ts` pattern is copied to future route groups with many register/login
      cases, add a test-only lower bcrypt cost factor via env override (never touching the
      production cost-12 path) to keep wall time bounded — not needed yet at current suite size.
- [x] `test/integration/README.md`'s "Adding a new route group" section gets a one-line note
      that `.itest.ts` files share one Vitest "forks" worker per file (module state like
      `tokenVersionCache` persists across `it()` blocks in the same file), so new fixtures
      must keep using unique IDs per test the way `auth-routes.itest.ts` already does.

## Implementation Notes

- `test/integration/auth-routes.itest.ts`
- `test/integration/README.md`

## Dependencies

None.

## Risks

None — documentation and forward-looking scaling notes only.

## Updates

### 2026-07-12

- Filed from dual code review of PR #594 during the "review, fix, codify, close all open PRs" session.
