---
title: "No automated guard enforces the fast-check seed-pinning convention on future property tests"
status: backlog
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

- [ ] A grep-based guard test (matching the repo's existing facade/pattern-enforcement style)
      asserts every `**/__tests__/**/*.property.test.ts` file contains a `seed:` key in its
      `fc.assert`/`fc.check` config.
- [ ] The guard is wired into the normal test suite (or a hook) so it runs automatically, not
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
