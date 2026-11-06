---
title: "React Compiler lint rules still off: set-state-in-effect, immutability, refs"
status: done
priority: low
created: 2026-11-04
updated: 2026-11-06
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

- [x] Each rule is either enabled in `eslint.config.js` with its call sites
      fixed, or left off with a one-line reason next to `KEPT_REACT_HOOKS_RULES`.
- [x] `eslint-plugin-ocrecipes/__tests__/rules.test.ts` lists exactly the
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

### 2026-11-06

- Owner unlocked the todo; all three rules are now enabled in
  `KEPT_REACT_HOOKS_RULES`, none left off, and `rules.test.ts` lists exactly
  the enabled set.
- `refs`: #1768 (11 sites). `immutability`: #1769 (24 sites).
- `set-state-in-effect`: #1770 batch B (15), #1771 batch A (14), #1772 batch
  C1 (11), and the final batch `chore/set-state-in-effect-final` (13: the last
  12 inventoried sites plus ProfileScreen's first-mount flag, which #1768 had
  turned into state), which also turns the rule on globally and drops the 11
  per-file `/* eslint react-hooks/set-state-in-effect: "error" */` headers.
- Final state on `client/` (`ESLINT_NO_TYPE_AWARE=1 npx eslint client
--report-unused-disable-directives`): 0 errors, 0 set-state-in-effect
  reports, 0 unused directives; 22 justified
  `eslint-disable-next-line react-hooks/set-state-in-effect` lines across 17
  files. Bailout baseline 55 files (NotebookEntryScreen dropped; it compiles
  since #1772).
