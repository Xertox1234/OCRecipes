---
title: "Burn down suppressed async-lint violations in server/routes"
status: backlog
priority: low
created: 2026-05-18
updated: 2026-05-18
assignee:
labels: [deferred, code-quality]
github_issue:
---

# Burn down suppressed async-lint violations in server/routes

## Summary

Resolve the ~5 type-aware ESLint violations in `server/routes/**` that were
snapshotted into `eslint-suppressions.json` when type-aware linting was adopted.

## Background

Type-aware `@typescript-eslint` rules were adopted via a bulk-suppression ratchet
(PR #228, spec `docs/superpowers/specs/2026-05-18-type-aware-eslint-design.md`).
The existing 250-violation backlog was suppressed so CI gates only new violations.
This is tier 1 of the burndown — request handlers, where a dropped promise is a
silent 500 or a half-completed mutation, so the spec prioritizes it first
(target: within 2 weeks of the adoption PR merging).

## Acceptance Criteria

- [ ] Every `server/routes/**` entry in `eslint-suppressions.json` is resolved —
      either genuinely fixed or marked `void` per the policy below
- [ ] `npm run lint:suppress:prune` run; the reduced `eslint-suppressions.json` committed
- [ ] `npm run lint` still exits 0

## Implementation Notes

- The suppressed rules in this area are `@typescript-eslint/no-floating-promises`
  and `@typescript-eslint/no-misused-promises`. Find the exact files/lines by
  reading the `server/routes/...` keys in `eslint-suppressions.json`.
- For each violation, **either** genuinely fix it (add `await`, `.catch`, or real
  error handling) **or**, if it is a deliberate fire-and-forget, mark it `void`.
- `void` policy (spec Section 4): `void someAsyncCall()` is acceptable **only**
  when the promise has its own internal error handling (`try/catch` or `.catch`)
  **or** the failure mode is provably safe to drop. A bare `void` with neither is
  a real bug — fix it instead.
- After resolving, `npm run lint:suppress:prune` rewrites `eslint-suppressions.json`
  to the lower count; commit it so the CI staleness gate re-tightens.

## Dependencies

- PR #228 (type-aware ESLint adoption) must be merged first.

## Risks

- Bulk-`void`-ing to clear the count fast would convert latent bugs into
  permanently hidden ones — each `void` must satisfy the policy above.

## Updates

### 2026-05-18

- Initial creation (burndown tier 1; ~5 violations).
