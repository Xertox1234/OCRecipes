---
title: "Adopt the React Compiler lint rules from eslint-plugin-react-hooks 7, one rule at a time"
status: backlog
priority: low
created: 2026-10-23
updated: 2026-10-29
assignee:
labels: [deferred, react-native]
github_issue:
---

# Adopt the React Compiler lint rules from eslint-plugin-react-hooks 7

## Summary

The SDK 56 upgrade brought eslint-plugin-react-hooks 7.1.1 (via
eslint-config-expo 56), whose recommended set adds 15 React Compiler rules.
They flagged 104 existing call sites, so `eslint.config.js` turns them all
off. Turn them back on one at a time, fixing the call sites each one flags.

## Background

Turning them on inside the SDK bump would have meant ~100 behavioural edits
in a dependency PR. Counts at the SDK 56 upgrade (CI run on 1e031334):
`set-state-in-effect` 50, `immutability` 27, `refs` 14,
`preserve-manual-memoization` 11, `globals` 2. The rest flagged nothing.
These overlap with the React Compiler bailout ratchet that preflight
already runs: a site these rules flag is often one the compiler skips.

## Acceptance Criteria

- [ ] Each rule is either enabled in `eslint.config.js` with its call sites
      fixed, or left off with a one-line reason next to `KEPT_REACT_HOOKS_RULES`.
- [ ] `eslint-plugin-ocrecipes/__tests__/rules.test.ts` ("keeps react-hooks to
      the two pre-compiler rules") lists exactly the enabled rules.

## Implementation Notes

- Start with the rules that flag nothing or little (`globals`, then
  `preserve-manual-memoization`), one PR per rule.
- `set-state-in-effect` is the largest group: many are reset-on-prop-change
  effects; React's guidance is to derive the value or key the component.
- Files in scope: `eslint.config.js`,
  `eslint-plugin-ocrecipes/__tests__/rules.test.ts`, and the client files each
  rule flags (`npx eslint client` lists them once the rule is enabled).

## Progress

- 2026-10-29: `react-hooks/globals` enabled (2 test-file call sites fixed:
  `Capture` helpers now assign `api` in an effect). Remaining rules stay off
  with reasons in `eslint.config.js`. Re-counted `preserve-manual-memoization`
  at 11 sites (CoachChat, QuickAddSheet, RecipeIngredientsList x2, ChatScreen,
  CookSessionCaptureScreen, GroceryListScreen, MealPlanHomeScreen x4); fixes
  alter hook deps and need per-site judgement. Todo stays open for those and
  `set-state-in-effect` / `immutability` / `refs`.
