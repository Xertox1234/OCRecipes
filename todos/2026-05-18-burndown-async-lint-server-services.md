---
title: "Burn down suppressed async-lint violations in server/services and other backend/shared code"
status: backlog
priority: low
created: 2026-05-18
updated: 2026-05-18
assignee:
labels: [deferred, code-quality]
github_issue:
---

# Burn down suppressed async-lint violations in server/services and other backend/shared code

## Summary

Resolve the ~21 type-aware ESLint violations in `server/services/**` (2) plus
other non-route backend and `shared/` files (~19) that were snapshotted into
`eslint-suppressions.json` when type-aware linting was adopted.

## Background

Type-aware `@typescript-eslint` rules were adopted via a bulk-suppression ratchet
(PR #228, spec `docs/superpowers/specs/2026-05-18-type-aware-eslint-design.md`).
This is tier 2 of the burndown. The spec named `server/services/**`; the actual
measurement found only 2 there, so this todo also sweeps the ~19 violations in
other backend/shared files (`server/` non-route modules, `shared/`, `evals/`,
root scripts) — they are the same bug class and burn naturally together.
Target: within ~1 month after tier 1.

## Acceptance Criteria

- [ ] Every `server/services/**` entry and every other non-route, non-`client`,
      non-test entry in `eslint-suppressions.json` is resolved — fixed or `void`-marked
- [ ] `npm run lint:suppress:prune` run; the reduced `eslint-suppressions.json` committed
- [ ] `npm run lint` still exits 0

## Implementation Notes

- Suppressed rules here are `@typescript-eslint/no-floating-promises`,
  `@typescript-eslint/no-misused-promises`, and `@typescript-eslint/require-await`.
  Find exact files/lines from the non-`client`/non-`server/routes`/non-test keys
  in `eslint-suppressions.json`.
- The AI services contain intentional fire-and-forget background work — those are
  correct and should be marked `void`, not "fixed."
- `void` policy (spec Section 4): `void someAsyncCall()` is acceptable **only**
  when the promise has its own internal error handling (`try/catch` or `.catch`)
  **or** the failure mode is provably safe to drop. A bare `void` with neither is
  a real bug — fix it instead.
- `require-await` violations are genuine smells (an `async` function with no
  `await`): either remove `async` and return a resolved promise, or add the
  missing `await`.
- After resolving, `npm run lint:suppress:prune` and commit the updated file.

## Dependencies

- PR #228 (type-aware ESLint adoption) must be merged first.
- Best done after the tier-1 `server/routes` burndown.

## Risks

- Misclassifying a real bug as intentional fire-and-forget and `void`-marking it.

## Updates

### 2026-05-18

- Initial creation (burndown tier 2; ~21 violations — 2 in `server/services`,
  ~19 in other backend/shared files).
