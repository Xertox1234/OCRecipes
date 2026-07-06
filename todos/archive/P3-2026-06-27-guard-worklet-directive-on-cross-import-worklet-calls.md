---
title: "Static guard: flag non-worklet functions called inside Reanimated worklets"
status: done
priority: low
created: 2026-06-27
updated: 2026-07-05
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

- [x] A guard exists that fails CI when a function called inside a worklet body (`runOnUI(() => { "worklet"; ... })`, `useAnimatedStyle`, `useAnimatedScrollHandler`, gesture worklets, etc.) is an imported function lacking a `"worklet"` directive at its definition.
- [x] It does NOT flag Reanimated worklet built-ins (`measure`, `scrollTo`, `withTiming`, …) or `Math.*`/other worklet-safe globals.
- [x] Known-good precedent (`client/lib/volume-scale.ts` → `volumeToScale`, with the directive) passes; an intentional regression (directive removed) fails.
- [x] Low false-positive rate; documented in `docs/rules/react-native.md` if adopted.

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
- **Known limitation (accepted, not fixed):** the shadow-check only matches a simple identifier binding. A destructured local/parameter sharing an import's name (e.g. `runOnUI(({ badFn }) => { "worklet"; badFn(1); })` where `badFn` is also a cross-file import) reproduces a false positive — the destructured binding is invisible to the shadow check, so the call is misattributed to the import. Rare in this codebase's style; documented in `scripts/worklet-directive-guard.ts`'s Scope comment. Widening `bindingNameMatches` to walk `ObjectBindingPattern`/`ArrayBindingPattern` elements would close it.

## Updates

### 2026-06-27

- Filed after hotfixing the `glideToTopOffset` worklet crash (one-line `"worklet"` directive). Captures the optional automated guard; the immediate fix is already shipped.

### 2026-07-05

- Implemented as a source-scanning Vitest static guard (`scripts/worklet-directive-guard.ts` + `scripts/__tests__/worklet-directive-guard.test.ts`), using the TypeScript compiler API rather than `@babel/parser` (already a direct devDependency, no new dependency needed). Scans `client/**` for worklet-context call sites (`runOnUI`, `useAnimatedStyle`, `useAnimatedProps`, `useAnimatedScrollHandler`, `useAnimatedGestureHandler`, `useAnimatedReaction`, `useDerivedValue`, and Gesture-builder callback methods), resolves bare-identifier calls inside each worklet body against the file's named imports (relative path or `@/`/`@shared/` alias only), and flags any resolved cross-file function whose definition doesn't start its body with a `"worklet";` directive.
- Two code-review rounds (code-reviewer + mobile-reviewer, then a code-reviewer follow-up): round 1 found two WARNINGs — a name-only match that could misattribute a locally-shadowed identifier to an unrelated same-named import (fixed via a new `isLocallyShadowed` scope-walk), and a file-location mismatch (moved from `client/lib/` to `scripts/` + `scripts/__tests__/`, matching the repo's established convention for Node-only static-analysis tooling, e.g. `scripts/check-hardcoded-colors.js`). Round 2 confirmed both resolved (verified empirically against ~10 synthetic shadow shapes) with only a test-coverage WARNING (4 of 5 shadow branches lacked dedicated tests) and two documentation SUGGESTIONs, all addressed: added tests for the parameter/catch/for-loop shadow branches plus a "must not over-suppress a genuine offender" regression test, and documented the destructured-binding gap above.
- 19 unit/integration tests total, including the real-tree integration scan (currently zero offenders across `client/**`) and an explicit regression test proving the guard would have caught the original `glideToTopOffset` bug shape.
