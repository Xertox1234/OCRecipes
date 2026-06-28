---
title: "Static guard: flag non-worklet functions called inside Reanimated worklets"
status: backlog
priority: low
created: 2026-06-27
updated: 2026-06-27
assignee:
labels: [deferred, react-native, code-quality]
github_issue:
---

# Static guard: flag non-worklet functions called inside Reanimated worklets

## Summary

Add a lightweight static check (lint rule or source-scanning test) that catches an imported, non-`"worklet"` function being called inside a `runOnUI` / worklet body — the exact bug class that crashed the Home inline drawers and was invisible to `tsc`, ESLint, and the unit suite.

## Background

PR #470's inline-drawer glide called `glideToTopOffset` (a pure util) inside `HomeScreen.glideRowToTop`'s `runOnUI` worklet without a `"worklet"` directive. The Reanimated 4 Babel plugin does not workletize across module imports, so on the UI thread the call was fatal ("[Worklets] Tried to synchronously call a non-worklet function on the UI thread"). In dev it's a redbox; in **release/OTA it's a silent app close**. Every static gate passed — the broken contract is a runtime UI-thread one. Fixed in the `glideToTopOffset`-worklet hotfix; the real process lesson is "run worklet code on a sim/device before merge," but a cheap automated guard would catch regressions and new worklet utils that forget the directive.

## Acceptance Criteria

- [ ] A guard exists that fails CI when a function called inside a worklet body (`runOnUI(() => { "worklet"; ... })`, `useAnimatedStyle`, `useAnimatedScrollHandler`, gesture worklets, etc.) is an imported function lacking a `"worklet"` directive at its definition.
- [ ] It does NOT flag Reanimated worklet built-ins (`measure`, `scrollTo`, `withTiming`, …) or `Math.*`/other worklet-safe globals.
- [ ] Known-good precedent (`client/lib/volume-scale.ts` → `volumeToScale`, with the directive) passes; an intentional regression (directive removed) fails.
- [ ] Low false-positive rate; documented in `docs/rules/react-native.md` if adopted.

## Implementation Notes

- Two candidate approaches:
  1. **Source-scanning Vitest test** (cheaper, repo already has "static guard" tests): scan `client/**` for `runOnUI(`/worklet contexts, extract called identifiers, resolve imports, assert each imported callee's source carries `"worklet"`. AST via `@babel/parser` for accuracy; a regex heuristic is likely too noisy.
  2. **Custom ESLint rule** (richer, more work): operate on worklet-context call expressions; integrate with the existing type-aware ESLint setup.
- Scope realistically: only the `runOnUI` + common worklet hooks; full data-flow worklet inference is out of scope.
- This is a defense-in-depth nicety, not a blocker — the per-function comment on `glideToTopOffset` and the `volumeToScale` precedent already document the requirement.

## Dependencies

- None.

## Risks

- AST-based import resolution + alias (`@/`) handling can get fiddly; keep the rule conservative to avoid false positives that erode trust.

## Updates

### 2026-06-27

- Filed after hotfixing the `glideToTopOffset` worklet crash (one-line `"worklet"` directive). Captures the optional automated guard; the immediate fix is already shipped.
