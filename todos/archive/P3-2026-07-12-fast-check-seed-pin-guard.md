---
title: "No automated guard enforces the fast-check seed-pinning convention on future property tests"
status: done
priority: low
created: 2026-07-12
updated: 2026-07-12
assignee:
labels: [deferred, testing]
github_issue:
---

# No automated guard enforces the fast-check seed-pinning convention on future property tests

## Summary

`server/lib/__tests__/chat-history-truncate.property.test.ts` pins `seed: 20260712` on every
`fc.assert` call (documented as required because `vitest.config.ts` sets `retry: 2`, and an
unseeded property that finds a genuine counterexample could pass on retry with a fresh seed,
absorbing a real bug as a flake). The pinning is a per-file convention with no automated
enforcement — a future `*.property.test.ts` file could omit the seed and nothing would catch it.

## Background

Surfaced during code review of PR #592 (first fast-check property tests in the repo).
SUGGESTION-tier, non-blocking — filed as a low-severity follow-up per the convention.

## Acceptance Criteria

- [x] A grep-based guard test (matching the repo's existing facade/pattern-enforcement style)
      asserts every `**/__tests__/**/*.property.test.ts` file contains a `seed:` key in its
      `fc.assert`/`fc.check` config.
- [x] The guard is wired into the normal test suite (or a hook) so it runs automatically, not
      just documented in a solutions file.

## Implementation Notes

- `server/lib/__tests__/chat-history-truncate.property.test.ts` — the only current property
  test file; use it as the guard's positive fixture.
- `docs/solutions/conventions/fast-check-property-tests-pin-seed-not-in-mutation-testinclude-2026-07-12.md`
  — existing codified convention this guard would enforce.

## Dependencies

None.

## Risks

None — additive test tooling only.

## Updates

### 2026-07-12

- Filed from code review of PR #592 during the "review, fix, codify, close all open PRs" session.

### 2026-07-12 (implementation)

- Added `scripts/__tests__/fast-check-property-seed-guard.test.ts`: a repo-wide (denylist-scoped,
  not source-root-allowlisted) grep/regex-based guard, following the same self-contained style as
  `server/services/notifications/__tests__/facade-only.test.ts`. Discovers `*.property.test.ts`
  files inside any `__tests__` directory, then flags any `fc.assert(...)`/`fc.check(...)` call
  that has neither an inline `{ seed: ... }` argument nor a reference to a shared
  `const IDENT = { ...seed... }` object (the repo's actual convention, as used in
  `chat-history-truncate.property.test.ts`'s `FC_PARAMS`).
- AC #2 (auto-wired into the suite) is satisfied purely by the `.test.ts` filename — Vitest's
  `include: ["**/*.test.ts", ...]` glob discovers it automatically, no extra hook/config needed.
- Two review rounds (code-reviewer): round 1 found unbalanced-paren-in-string over-read and
  callback-body false-identifier-match risks in the extraction logic, plus a missing `.worktrees`
  exclusion — all fixed (added a string/comment-aware lexer helper, scoped the seed search to the
  call's trailing config arguments only, added the exclusion). Round 2 found the same
  comment-unawareness gap in the `const`-declaration scan (a `//`-commented fake declaration could
  shadow a real unseeded one) — fixed with the same span-skipping helper. A remaining edge case
  (regex literals can still desync the paren counter) was left as a documented, non-blocking
  limitation — full regex-vs-division disambiguation is out of scope for a grep-based guard and
  does not affect the current real property test file.
