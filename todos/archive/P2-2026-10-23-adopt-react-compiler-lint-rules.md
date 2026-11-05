---
title: "Enable react-hooks/preserve-manual-memoization (React Compiler lint rules, next rule)"
status: done
priority: medium
created: 2026-10-23
updated: 2026-11-04
assignee:
labels: [deferred, react-native]
github_issue:
---

# Enable react-hooks/preserve-manual-memoization

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

- [x] `react-hooks/preserve-manual-memoization` is enabled in `eslint.config.js`
      and `npx eslint client` reports zero sites for it.
- [x] Each of the 11 sites is fixed, or — only where the current form is really
      needed — carries an inline
      `// eslint-disable-next-line react-hooks/preserve-manual-memoization -- <reason>`.
- [x] `eslint-plugin-ocrecipes/__tests__/rules.test.ts` ("keeps react-hooks to
      the two pre-compiler rules") lists exactly the enabled rules.
- [x] One PR, this rule only. Do NOT start `set-state-in-effect`, `immutability`
      or `refs` — they live in the human-led
      `todos/P3-2026-11-04-react-compiler-lint-remaining-rules.md`.

## Implementation Notes

- Per site, prefer the smallest fix: make the manual `useMemo`/`useCallback`
  deps match what the compiler infers, or drop the manual memo when the
  component compiles (the compiler memoizes it). Keep behaviour identical —
  watch for effects that depend on the memoized value's identity.
- Check the React Compiler bailout baseline afterwards: a fixed site may now
  compile and need removing from `scripts/react-compiler-bailout-baseline.json`
  (preflight's ratchet says so; regenerate it with its `--update-baseline` run,
  as #1734 did).
- Files in scope: `eslint.config.js`,
  `eslint-plugin-ocrecipes/__tests__/rules.test.ts`, the client files this
  rule flags (`npx eslint client` lists them once the rule is enabled), and
  `scripts/react-compiler-bailout-baseline.json` if a site leaves it.

## Progress

- 2026-10-29: `react-hooks/globals` enabled (2 test-file call sites fixed:
  `Capture` helpers now assign `api` in an effect). Remaining rules stay off
  with reasons in `eslint.config.js`. Re-counted `preserve-manual-memoization`
  at 11 sites (CoachChat, QuickAddSheet, RecipeIngredientsList x2, ChatScreen,
  CookSessionCaptureScreen, GroceryListScreen, MealPlanHomeScreen x4); fixes
  alter hook deps and need per-site judgement. Todo stays open for those and
  `set-state-in-effect` / `immutability` / `refs`.

## Updates

### 2026-11-04

- Owner ruling: the automation does the next rule only
  (`preserve-manual-memoization`, 11 sites), one PR, raised to medium (renamed
  from P3) so the PR waits for owner review — the fixes change hook deps. A site
  that really needs its current form gets an inline eslint-disable with a
  reason. The remaining rules moved to the human-led
  `todos/P3-2026-11-04-react-compiler-lint-remaining-rules.md`.

### 2026-11-04 (implemented)

- Rule enabled. It flagged 7 sites in 6 files (the 11 counted earlier had
  shrunk). No inline disables were needed.
- QuickAddSheet, RecipeIngredientsList (x2), GroceryListScreen: the memo read
  `x?.y` but the compiler inferred `x`; the property is now read into a local
  before the memo and the local is the dep (same recompute frequency).
- CoachChat, ChatScreen, CookSessionCaptureScreen: an effect called
  `handleSend`/`handleAnalyzePhoto` before its `useCallback` was declared; the
  effect now sits after the callback (no other effect in between acts on mount).
- Bailout baseline shrank by 2 (RecipeIngredientsList, GroceryListScreen).
