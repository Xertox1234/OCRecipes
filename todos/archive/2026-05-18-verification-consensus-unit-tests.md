---
title: "Add unit tests for the extracted verification-consensus pure functions"
status: done
priority: low
created: 2026-05-18
updated: 2026-05-18
assignee:
labels: [deferred, testing, database]
github_issue:
---

# Add unit tests for the extracted verification-consensus pure functions

## Summary

`server/lib/verification-consensus.ts` exposes the pure functions `valuesMatch`,
`nutritionMatches`, and `compareWithVerifications`. They are currently exercised
only indirectly (via `server/storage/__tests__/verification.concurrent.test.ts`).
Add a dedicated unit-test file.

## Background

Surfaced by a full-branch `kimi-review` on the `todo/2026-05-18-verification-
presubmit-ismatch-race` stack (the PR #219 follow-up that moved these functions
into `server/lib/` so storage could import them without violating the
service→storage dependency direction). The 5% tolerance logic, small/zero-value
edge cases, and the pairwise-match strategy are non-trivial and warrant focused
coverage.

## Acceptance Criteria

- [ ] Add `server/lib/__tests__/verification-consensus.test.ts`.
- [ ] Cover `valuesMatch` edge cases: both zero, one zero, values just inside
      and just outside the 5% / absolute-1 tolerance boundary.
- [ ] Cover `nutritionMatches` with all-null fields and partial-null fields.
- [ ] Cover `compareWithVerifications`: empty history (first verification),
      matching history, divergent history.

## Implementation Notes

- Pure functions — no DB, no mocks needed. Plain Vitest.
- Note the pre-existing behaviours flagged during the PR #219 review (do not
  "fix" them here, just test current behaviour): `valuesMatch`'s absolute
  tolerance of 1 for values < 2; `compareWithVerifications` returning
  `isMatch=true` for the first verification regardless of content.

## Dependencies

- The `todo/2026-05-18-verification-presubmit-ismatch-race` branch (which
  created `server/lib/verification-consensus.ts`) must be merged first.

## Risks

- Low. Test-only addition.

## Updates

### 2026-05-18

- Created from a full-branch kimi-review WARNING after the `/todo` session.

## Copilot Delegation

Eligible (test-only) — but Copilot delegation is parked per CLAUDE.md; complete
via the `/todo` skill.
