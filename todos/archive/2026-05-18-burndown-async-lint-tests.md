---
title: "Burn down suppressed async-lint violations in test files"
status: backlog
priority: low
created: 2026-05-18
updated: 2026-05-18
assignee:
labels: [deferred, code-quality]
github_issue:
---

# Burn down suppressed async-lint violations in test files

## Summary

Resolve the ~9 type-aware ESLint violations in test files (`**/__tests__/**`,
`*.test.{ts,tsx}`, `*.spec.{ts,tsx}`) that were snapshotted into
`eslint-suppressions.json` when type-aware linting was adopted.

## Background

Type-aware `@typescript-eslint` rules were adopted via a bulk-suppression ratchet
(PR #228, spec `docs/superpowers/specs/2026-05-18-type-aware-eslint-design.md`).
This is tier 4 — the lowest-risk tier. Note `@typescript-eslint/require-await` is
disabled for test files (Vitest/RTL mock-signature noise), so these ~9 are
`no-floating-promises` / `no-misused-promises` in test code — a floating promise
in a test can mask a flaky or silently-passing test, so they are still worth
fixing. Target: within ~1 month after tier 3.

## Acceptance Criteria

- [ ] Every test-file entry in `eslint-suppressions.json` is resolved —
      fixed or `void`-marked per the policy below
- [ ] `npm run lint:suppress:prune` run; `eslint-suppressions.json` ideally
      reaches zero entries (file deleted) once all four tiers are done
- [ ] `npm run lint` and `npm run test:run` still pass

## Implementation Notes

- Find exact files/lines from the test-path keys in `eslint-suppressions.json`.
- A floating promise in a test is usually a missing `await` on an async
  assertion or helper — fixing it (adding `await`) is almost always correct here;
  `void` is rarely the right call in test code.
- `void` policy (spec Section 4): acceptable **only** when the promise has its
  own internal error handling **or** the failure is provably safe to drop.
- After resolving, `npm run lint:suppress:prune` and commit the updated file.

## Dependencies

- PR #228 (type-aware ESLint adoption) must be merged first.
- Final tier — best done after tiers 1–3.

## Risks

- Low. A `void` in test code that hides a genuinely failing async assertion would
  mask a broken test.

## Updates

### 2026-05-18

- Initial creation (burndown tier 4; ~9 violations).
