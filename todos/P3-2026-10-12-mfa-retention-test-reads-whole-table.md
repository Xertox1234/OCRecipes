---
title: "MFA retention test fails when the local DB already has a challenge row"
status: backlog
priority: low
created: 2026-10-12
updated: 2026-10-12
assignee:
labels: [deferred, testing]
github_issue:
---

# MFA retention test fails when the local DB already has a challenge row

## Summary

`server/scripts/__tests__/cleanup-retention-mfa.test.ts` reads the whole `mfa_challenges` and `mfa_trusted_devices` tables, so any row already in the dev database (for example from signing in to the local server with a two-step account) makes it fail.

## Background

Found 2026-10-12 at the `/todo` baseline: the test failed with an extra challenge row (`expected [ …(3) ] to deeply equal [ 'ch-1-hour', 'ch-live' ]`). The row came from a local two-step sign-in during the visual QA sweep, not from code. Deleting it made the test pass. The test runs inside a rolled-back transaction, but that only hides the test's own writes — rows already committed in the database stay visible.

The `rowsDeleted` counts at `:102-106` have the same weakness: a pre-existing row expired for over a day would be purged too and change the count.

## Acceptance Criteria

- [ ] The challenge and trusted-device assertions (`:107-118`) filter to the test's own users (`a`, `b`, `c`), not the whole table.
- [ ] The `rowsDeleted` assertions can't be thrown off by older rows (e.g. count only the test's rows, or assert on the remaining rows per user instead).
- [ ] The test passes with an unrelated expired and an unrelated live challenge row present in the database (add one in the test setup to prove it).

## Implementation Notes

- File: `server/scripts/__tests__/cleanup-retention-mfa.test.ts` (`:100-118`).
- Use `inArray(mfaChallenges.userId, [a.id, b.id, c.id])` from drizzle-orm on the selects.

## Scope Contract

- **Files in scope:** `server/scripts/__tests__/cleanup-retention-mfa.test.ts` only.
- No changes to `server/scripts/cleanup-retention.ts`.

## Dependencies

- None.

## Risks

- None; test-only.

## Updates

### 2026-10-12

- Filed from the `/todo` baseline run.
