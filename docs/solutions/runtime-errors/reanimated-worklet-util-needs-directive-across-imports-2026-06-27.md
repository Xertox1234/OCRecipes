---
title: Reanimated util called inside a worklet needs its own "worklet" directive — Babel does not workletize across imports
track: bug
category: runtime-errors
module: client
severity: high
tags: [reanimated, worklets, react-native, runOnUI, babel, ota, ui-thread, harness]
symptoms: [Tapping a control that triggers a Reanimated runOnUI worklet closes the app silently in a release/OTA build (no error overlay)., 'Dev build shows a redbox: "[Worklets] Tried to synchronously call a non-worklet function `<name>` on the UI thread."', 'tsc, ESLint, and the full unit suite all pass, yet the feature crashes only on a device/simulator.']
applies_to: [client/**/*.ts, client/**/*.tsx, scripts/worklet-directive-guard.ts]
created: '2026-06-27'
last_updated: '2026-09-21'
---

# Reanimated util called inside a worklet needs its own "worklet" directive — Babel does not workletize across imports

## Problem

A pure utility function imported from another module and **called inside a Reanimated worklet** (e.g. a `runOnUI(() => { "worklet"; ... })` body, or an animated hook) must itself carry a `"worklet"` directive at its definition. Without it, the call is fatal on the UI thread. In a **dev** build this is a redbox; in a **release/OTA** build the same fatal has **no overlay — the app just closes silently**.

## Symptoms

- Tap → silent app close on release/OTA; redbox in dev naming the function.
- Error text: `[Worklets] Tried to synchronously call a non-worklet function `<name>` on the UI thread.`
- Every static gate (`tsc`, ESLint, unit tests) is green — the bug is invisible to CI.

## Root Cause

The Reanimated Babel plugin (`react-native-reanimated/plugin`, Reanimated 4 / `react-native-worklets`) workletizes a function **only when it carries a `"worklet"` directive**, and it processes **one file at a time** — it does **not** follow `import` edges. So an imported plain function referenced inside a worklet reaches the UI thread as a non-worklet reference, and calling it there throws a fatal Worklets error.

CI can't catch this: the JS-thread contract is fully satisfied (the function is a valid TS function with passing unit tests). The broken contract is a **runtime, UI-thread** one that only the Worklets runtime enforces, and only when the worklet actually executes — i.e. only on a device/simulator.

Real case: `glideToTopOffset` (`client/components/home/inline-drawer-utils.ts`, shipped in PR #470) was called inside `HomeScreen.glideRowToTop`'s `runOnUI` glide worklet alongside `measure()`/`scrollTo()`. It lacked the directive, so tapping "Search Recipes" / "Generate Recipe" closed the app on the OTA build. Reproduced as a redbox in the iOS Simulator; fixed in PR #473 (`2564fbc0`).

## Solution

Add `"worklet";` as the **first statement** of the function body, matching the existing precedent `client/lib/volume-scale.ts` → `volumeToScale`:

```ts
export function glideToTopOffset(
  currentScrollY: number,
  rowPageY: number,
  collapsedBarHeight: number,
): number {
  "worklet";
  return Math.max(0, currentScrollY + (rowPageY - collapsedBarHeight));
}
```

The directive is a **no-op when the function runs on the JS thread**, so existing unit tests (which call it directly) are unaffected. Keep the body worklet-safe: only arithmetic, `Math.*`, and other worklet-supported globals — no closures over JS-thread-only refs, no async. Reanimated built-ins used in the worklet (`measure`, `scrollTo`, `withTiming`, …) are already worklets and need nothing.

Add a comment on the function noting it MUST stay a worklet, so a future refactor doesn't strip the directive.

## Prevention

- Any function **called inside** a worklet body must be a worklet at its definition — including imported utilities. Inlining the math into the worklet is the alternative when you don't want a shared worklet util.
- **Verify Reanimated/worklet code on a device or simulator before merge.** Static gates cannot model UI-thread runtime contracts; a dev-build run surfaces the redbox that a release build hides.
- The automated guard (below) is name-keyed, not semantic — **whenever the app adopts a new worklet-scheduling entry point (a rename, a new library API, a wrapper hook), add its name to `WORKLET_CALLBACK_HOOKS` in `scripts/worklet-directive-guard.ts` in the SAME change**, or the guard silently stops inspecting that call shape instead of flagging it. Caught 2026-09-21 (`todos/archive/P3-2026-09-20-reanimated-4-deprecated-worklet-apis.md`): migrating `HomeScreen.tsx`'s `runOnUI(() => {"worklet"; glideToTopOffset(...); })()` — this file's own real case, `glideToTopOffset` — to `react-native-worklets`' `scheduleOnUI(() => {"worklet"; glideToTopOffset(...); })` (the direct-args replacement; see the migration guide cited in that todo) left `WORKLET_CALLBACK_HOOKS` still only listing the literal string `"runOnUI"`, so `collectWorkletBodies` stopped recognizing the migrated call as a worklet context at all — not "checked it and found it compliant," but never looked. Reproduced with a constructed probe: an identical missing-directive shape was flagged under the old `runOnUI` name and silently missed under the new `scheduleOnUI` name, with the guard's own test suite (`scripts/__tests__/worklet-directive-guard.test.ts`) staying green throughout, because its real-tree integration test only asserts `offenders === []`, which can't distinguish "compliant" from "never inspected." Fixed by adding `"scheduleOnUI"` alongside `"runOnUI"` (same calling convention — callback always the first argument) plus a dedicated regression test pinning the new entry (mutation-tested: fails when the Set entry is removed). `scheduleOnRN` (the `runOnJS` replacement) deliberately was **not** added — it bridges a UI-thread worklet's call back to the JS thread, so its argument is a plain JS-thread function, never a worklet body the guard needs to inspect.
- Optional automated guard tracked in `todos/P3-2026-06-27-guard-worklet-directive-on-cross-import-worklet-calls.md` — implemented as `scripts/worklet-directive-guard.ts` / `scripts/__tests__/worklet-directive-guard.test.ts`.

## Related Files

- `client/components/home/inline-drawer-utils.ts` — `glideToTopOffset` (the fix).
- `client/screens/HomeScreen.tsx` — `glideRowToTop` (the `scheduleOnUI` call site, migrated from `runOnUI` 2026-09-21).
- `client/lib/volume-scale.ts` — `volumeToScale`, the pre-existing `"worklet"`-directive precedent.
- `scripts/worklet-directive-guard.ts` — the automated guard; `WORKLET_CALLBACK_HOOKS` must list every worklet-scheduling entry point by name.

## See Also

- `../code-quality/codeql-missing-rate-limiting-on-auth-test-fixture-2026-06-27.md` — another #470-era finding invisible to the usual gates (different mechanism).
