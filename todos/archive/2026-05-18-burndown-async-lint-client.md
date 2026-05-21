---
title: "Burn down suppressed async-lint violations in client"
status: backlog
priority: low
created: 2026-05-18
updated: 2026-05-18
assignee:
labels: [deferred, code-quality]
github_issue:
---

# Burn down suppressed async-lint violations in client

## Summary

Resolve the ~215 type-aware ESLint violations in `client/**` that were
snapshotted into `eslint-suppressions.json` when type-aware linting was adopted.
This is the bulk of the backlog.

## Background

Type-aware `@typescript-eslint` rules were adopted via a bulk-suppression ratchet
(PR #228, spec `docs/superpowers/specs/2026-05-18-type-aware-eslint-design.md`).
This is tier 3 of the burndown — the React Native screens, components, and hooks.
At ~215 violations it is by far the largest tier; consider splitting the work by
subdirectory (`client/screens`, `client/components`, `client/hooks`) across
multiple sessions. Target: within ~1 month after tier 2.

## Acceptance Criteria

- [ ] Every `client/**` entry in `eslint-suppressions.json` is resolved —
      fixed or `void`-marked per the policy below
- [ ] `npm run lint:suppress:prune` run after each batch; the reduced
      `eslint-suppressions.json` committed
- [ ] `npm run lint` still exits 0

## Implementation Notes

- The dominant rule here is `@typescript-eslint/no-floating-promises`. Find exact
  files/lines from the `client/...` keys in `eslint-suppressions.json`.
- Note: `no-misused-promises` runs with `checksVoidReturn.attributes: false`, so
  `async` JSX event handlers (`onPress={async...}`) are **not** flagged — these
  ~215 are floating promises in handler bodies and other async call sites, which
  is a real signal.
- For each violation, **either** genuinely fix it (add `await`, `.catch`, or real
  error handling) **or**, if it is a deliberate fire-and-forget, mark it `void`.
- `void` policy (spec Section 4): `void someAsyncCall()` is acceptable **only**
  when the promise has its own internal error handling (`try/catch` or `.catch`)
  **or** the failure mode is provably safe to drop. A bare `void` with neither is
  a real bug — fix it instead.
- Burn down in batches; run `npm run lint:suppress:prune` and commit after each
  batch so the CI staleness gate re-tightens incrementally.

## Dependencies

- PR #228 (type-aware ESLint adoption) must be merged first.
- Best done after the tier-1 and tier-2 server burndowns.

## Risks

- Volume — at ~215 violations, schedule pressure could push toward bulk-`void`ing.
  Each `void` must satisfy the policy above; this is the largest opportunity to
  hide real bugs if rushed.

## Updates

### 2026-05-18

- Initial creation (burndown tier 3; ~215 violations).
