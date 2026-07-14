---
title: Testing an extracted pure function doesn't prove it's correctly wired into the component
track: knowledge
category: conventions
module: client
tags: [testing, react-native, hooks, wiring-seam, integration-test]
applies_to: ["client/**/*-utils.ts", "client/screens/**/*.tsx", "client/hooks/**/*.ts"]
created: '2026-07-14'
---

# Testing an extracted pure function doesn't prove it's correctly wired into the component

## When this applies

The project's established `*-utils.ts` extraction convention (`docs/legacy-patterns` / `code-reviewer.md` Testing section) pulls pure derivation logic out of a component/hook so Vitest can unit-test it without the React Native render harness — e.g. `client/screens/label-analysis-utils.ts`'s `getLogButtonPresentation()`. That convention is correct and should keep being followed. The gap is stopping there: a thoroughly-tested pure function proves the *derivation* is correct, not that the *component* actually calls it with the right inputs, or that the *effects/mutations* feeding those inputs (a retry callback, an `onError` handler) behave correctly.

## Smell patterns

- A PR's diff includes a new/expanded `*-utils.ts` pure function with a comprehensive test matrix (`toEqual`, multiple branches, edge cases) — but the screen/hook file that calls it has zero test coverage of the surrounding effects, mutations, or event handlers.
- The bug being fixed was originally an effect/mutation wiring gap (a `useEffect`'s catch block silently swallowing an error, a mutation's `onError` writing to unreachable state) — and the fix's test suite only covers a newly-extracted pure function, not the wiring that caused the original bug.

## Why

PR #617 (fixing a silently-broken "Log X cal" button) extracted `getLogButtonPresentation()` and gave it an 18-case test matrix — genuinely thorough. But the actual defect had been in the *wiring*: an effect's catch block that silently preserved local data without surfacing an error, and two mutations' `onError` handlers writing to a dead state slot. None of that wiring — the retry effect re-triggering on `retryToken` change, the `toast.error(...)` calls actually firing from `onError` — has any test coverage in the same PR. The pure-function tests would stay green even if the component stopped calling `getLogButtonPresentation` at all, or called it with the wrong inputs, or the retry effect never re-ran.

This is the client-side sibling of [[route-tests-mock-auth-hide-wiring-seam]]'s server-side finding: extracting/mocking the interesting logic for cheap, isolated testing is the right call, but it structurally cannot cover the seam connecting that logic to the runtime system around it — that seam needs its own, separate test.

## Examples

Not yet built for the client side (PR #617 shipped without it, deliberately deferred given this project's RN-render-harness friction — `react-native-svg` Flow-syntax mock failures, `.test.ts`/`.test.tsx` basename collisions). The shape to reach for when it is: a `renderComponent`-based test (per `NotebookEntryScreen.test.tsx`'s pattern — mock `@react-navigation/native`, `@/context/ToastContext`, the network layer) that exercises the actual screen, triggers the failure path via a mocked rejected request, and asserts the mocked `toast.error` was called and/or the retry button becomes visible — not just that the pure derivation function returns the right object shape in isolation.

## Exceptions

Skipping the wiring test is a defensible, explicit trade-off (not a silent gap) when: the wiring is pure prop-passing with no branching of its own (e.g. `disabled={presentation.disabled}` has nothing left to get wrong once the presentation object is correct), or the RN render-harness cost genuinely outweighs the risk for a low-traffic screen. It stops being defensible when the wiring itself contains logic — a retry effect, a dependency array, an `onError` branch — that could be wrong independently of the extracted pure function.

## Related Files

- `client/screens/LabelAnalysisScreen.tsx` — the wiring left untested in PR #617
- `client/screens/label-analysis-utils.ts` — the pure function that *was* tested
- `client/screens/__tests__/label-analysis-utils.test.ts`

## See Also

- [../conventions/route-tests-mock-auth-hide-wiring-seam-2026-06-26.md](route-tests-mock-auth-hide-wiring-seam-2026-06-26.md) — the server-side sibling of this same class of gap
- [../logic-errors/toast-action-button-unreachable-by-screen-reader-2026-07-13.md](../logic-errors/toast-action-button-unreachable-by-screen-reader-2026-07-13.md) — another PR #617 finding, a wiring/integration defect this class of test would have caught
