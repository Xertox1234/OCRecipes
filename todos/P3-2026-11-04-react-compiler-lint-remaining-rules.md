---
title: "React Compiler lint rules still off: set-state-in-effect, immutability, refs"
status: backlog
priority: low
created: 2026-11-04
updated: 2026-11-04
assignee:
labels: [deferred, react-native]
github_issue:
human_led: true
blocked_reason: "Owner ruling 2026-11-04: automation does preserve-manual-memoization only (todos/P2-2026-10-23-adopt-react-compiler-lint-rules.md). These three rules change effects in ~90 components; the owner decides how to run them after reviewing that PR."
---

# React Compiler lint rules still off: set-state-in-effect, immutability, refs

## Summary

Three rules from eslint-plugin-react-hooks 7 stay off in `eslint.config.js`
(reasons next to `KEPT_REACT_HOOKS_RULES`). Each one means behavioural edits
across many components.

## Background

Split off on 2026-11-04 from
`todos/P2-2026-10-23-adopt-react-compiler-lint-rules.md`. Counts at the SDK 56
upgrade (CI run on 1e031334): `set-state-in-effect` 50, `immutability` 27,
`refs` 14. `globals` was enabled 2026-10-29; `preserve-manual-memoization` is
the P2 todo.

## Acceptance Criteria

- [ ] Each rule is either enabled in `eslint.config.js` with its call sites
      fixed, or left off with a one-line reason next to `KEPT_REACT_HOOKS_RULES`.
- [ ] `eslint-plugin-ocrecipes/__tests__/rules.test.ts` lists exactly the
      enabled rules.

## Implementation Notes

- One PR per rule; `set-state-in-effect` in PRs of at most ~15 sites.
- `set-state-in-effect`: many sites are reset-on-prop-change effects; React's
  guidance is to derive the value or key the component.
- A site that really needs its current form: inline eslint-disable with a reason.
- Owner to decide before running: autonomous vs interactive, and whether PRs are
  held for review.

## Scope Contract

- **Files in scope:** `eslint.config.js`,
  `eslint-plugin-ocrecipes/__tests__/rules.test.ts`, the client files each rule
  flags, `scripts/react-compiler-bailout-baseline.json`.
- No new mechanisms, files, or abstractions beyond those listed.

## Updates

### 2026-11-04

- Split off from the P2 todo (owner ruling 2026-11-04), human-led until the
  preserve-manual-memoization PR is reviewed.
