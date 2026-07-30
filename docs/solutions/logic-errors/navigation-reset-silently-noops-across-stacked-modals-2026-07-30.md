---
title: navigation.reset() silently no-ops when it must dismiss two stacked native modals
track: bug
category: logic-errors
tags: [react-navigation, react-native-screens, modal, navigation-stack, native-stack, silent-failure, testing]
module: client
applies_to: ["client/hooks/**/*.ts", "client/screens/**/*.tsx", "client/navigation/**/*.tsx"]
symptoms: ["A post-action navigation appears to do nothing — the mutation succeeds, the row is written, but the screen does not change", "No error, no warning, no log line — React Navigation drops an unhandled action silently", "navigation.getState() returns a byte-identical stack before and after the reset", "The unit test asserting navigation.reset() was called with the right payload passes the whole time the feature is broken"]
created: 2026-07-30
severity: medium
---

# navigation.reset() silently no-ops when it must dismiss two stacked native modals

## Problem

"Add to Today" on `NutritionDetail` wrote the `scanned_items` row, ran its
`onSuccess`, called `navigation.reset({ index: 0, routes: [{ name: "Main", params: { screen: "HomeTab" } }] })`
— and left the user exactly where they were. Nothing threw. Nothing logged.

## Symptoms

- The side effect (DB write, toast, haptic) happens; the navigation does not.
- `navigation.getState()?.routes.map(r => r.name)` is identical immediately
  before the reset and 400 ms after it.
- The route name in the reset payload is valid, the navigator is the root, and
  no `beforeRemove` / `usePreventRemove` listener exists anywhere in the stack.
- Existing tests pass, because they mock `useNavigation`.

## Root Cause

The stack at that moment was:

| Screen | Presentation |
|---|---|
| `Main` | card |
| `Scan` | `fullScreenModal` |
| `NutritionDetail` | `modal` |

Reaching `Main` therefore means dismissing **two stacked native modal
presentations in one state update**.

`reset` dispatches a wholesale state *replacement*. `react-native-screens`
reconciles React Navigation's JS state against the real native view-controller
stack — and when the native side does not tear both presentations down, the
library **reverts the JS state to match native reality**. The router accepted
the action; the native layer refused it; JS state was rolled back to agree.
React Navigation drops an unhandled action without throwing or warning, so the
whole failure is silent.

Device-verified on iOS 18.7.8 with temporary instrumentation:

```
[NAVDEBUG] stack BEFORE reset: ["Main","Scan","NutritionDetail"]
[NAVDEBUG] stack AFTER  reset: ["Main","Scan","NutritionDetail"]
```

## Solution

Dispatch a **POP**, not a state replacement. `popTo` is the same action path as
swiping a modal down, which native-stack implements natively, and it carries the
nested tab param in one action:

```ts
// client/hooks/useNutritionLookup.ts — addToLogMutation.onSuccess
-navigation.reset({ index: 0, routes: [{ name: "Main", params: { screen: "HomeTab" } }] });
+navigation.popTo("Main", { screen: "HomeTab" });
```

`popTo` requires React Navigation 7 (`@react-navigation/routers` `POP_TO`).
`popToTop()` also works when the destination is the first route and no nested
param is needed.

Verified that the nested tab switch still fires against an already-mounted tab
navigator: `POP_TO` builds fresh params via `createParamsFromAction` (merge
defaults false), so `params !== route.params`, and `useNavigationBuilder`
converts the changed `screen` param into a `CommonActions.navigate`.

## Prevention

**A mocked navigator can only prove which action was dispatched — never that the
platform honoured it.** Both pre-existing tests asserted
`expect(mockReset).toHaveBeenCalledWith({...})` and passed for the entire time
the feature was broken in users' hands, because `vi.mock("@react-navigation/native")`
cannot observe a native rejection.

- Assert the action you now depend on **and** guard against the broken one
  returning: `expect(mockPopTo).toHaveBeenCalledWith("Main", { screen: "HomeTab" })`
  plus `expect(mockReset).not.toHaveBeenCalled()`.
- Record in the test itself that it cannot prove the fix, so the next person
  knows a device check is required rather than trusting green.
- When a navigation action must cross more than one `presentation: "modal"` /
  `"fullScreenModal"` boundary, prefer a POP-family action over `reset`.
- `reset` remains fine where nothing is presented — e.g. a `safeGoBack`
  fallback that only runs when `canGoBack()` is false, which by definition means
  a single-route stack.

## Related Files

- `client/hooks/useNutritionLookup.ts` — `addToLogMutation.onSuccess`
- `client/navigation/RootStackNavigator.tsx` — `Scan` (`fullScreenModal`) and
  `NutritionDetail` (`modal`) registrations
- `client/hooks/__tests__/useNutritionLookup.labelRead.test.tsx`
- `client/hooks/__tests__/useNutritionLookup.test.ts`

## See Also

- [fullScreenModal dismissal requires navigation.goBack() after navigate()](fullscreen-modal-dismissal-needs-goback-2026-05-13.md) — the sibling case: one modal left in the stack after `navigate()`, rather than a rejected multi-modal teardown
- [RN Modal cannot overlay a React Navigation transparentModal](rn-modal-cannot-overlay-transparent-modal-2026-05-13.md) — another native-layer constraint that JS state alone does not express
- [../conventions/relaxing-a-shared-contract-requires-auditing-its-dependents-2026-07-30.md](../conventions/relaxing-a-shared-contract-requires-auditing-its-dependents-2026-07-30.md) — the general form of "green tests did not cover the thing that broke"
