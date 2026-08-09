---
title: A silence assertion is only as strong as its unstated preconditions — pin the harness default it depends on
track: bug
category: code-quality
tags: [testing, vitest, mocks, platform-gating, vacuous-test, accessibility, announceForAccessibility]
module: client
applies_to: ["client/**/__tests__/**", "test/mocks/react-native.ts"]
symptoms: ["A not.toHaveBeenCalled() guard keeps passing after the code it guards against is fully restored", "Changing a shared test-mock default (e.g. Platform.OS in test/mocks/react-native.ts) silently flips distant silence tests to vacuous — no red anywhere", "An absence test for platform-gated behavior never states which platform the harness resolves to"]
created: 2026-08-09
severity: medium
---

# A silence assertion is only as strong as its unstated preconditions — pin the harness default it depends on

## Problem

A test asserting that something does NOT happen (`expect(announce).not.toHaveBeenCalled()`)
guarded against reintroduction of a **condition-gated** behavior — an iOS-gated
`AccessibilityInfo.announceForAccessibility` effect (`Platform.OS === "ios" && error`). The
condition that would open that gate was supplied entirely by a shared harness default:
`test/mocks/react-native.ts` resolves `Platform.OS` to `"ios"`. The test never stated or
checked that dependency, so its guarding power was invisible — real today, gone the moment
the default changes, with no signal.

## Symptoms

- A `not.toHaveBeenCalled()` guard keeps passing after the code it guards against is fully
  restored.
- Changing a shared test-mock default (e.g. `Platform.OS`) silently flips distant silence
  tests to vacuous — no red anywhere, because a silence assertion passes harder when the
  gate never opens.
- An absence test for platform-gated behavior never states which platform the harness
  resolves to; a reader cannot tell whether the test observes "code is silent" or "gate
  never opened."

## Root Cause

Positive assertions carry intrinsic trigger evidence — if the setup stops producing the
behavior, the test fails. Negative assertions have none: `not.toHaveBeenCalled()` cannot
distinguish "the code under test is silent" from "the enabling condition never held." When
that enabling condition lives OUTSIDE the test file, in a shared mock default, the test's
validity is coupled to a file it never references. An edit there (or a prior test leaking a
`Platform.OS` override without restoring it) kills the guard with zero local diff — the
exact failure mode of an unenforced stated invariant, specialized to negative tests.

## Solution

Pin the enabling precondition inside the test, beside the negative control, so the guard
fails loudly instead of dying silently:

```tsx
// Negative control: the trigger state really fired.
await waitFor(() => expect(result.current.error).toBeTruthy());
// Stated precondition, not an assumption: the silence assertion below guards
// against a reintroduced iOS-gated announcer only while the harness resolves
// Platform.OS to "ios" — if that default ever changes, fail loudly here.
expect(Platform.OS).toBe("ios");
expect(announce).not.toHaveBeenCalled();
```

A robust silence test is therefore a **triple**: trigger control (the state fired) +
precondition pin (the gate would have been open) + the silence assertion itself. Found by
review of the hook-silence test that guards `useNutritionLookup`'s deleted iOS-gated error
announcer; the fix is one assertion and one import.

## Prevention

- Before accepting any `not.toHaveBeenCalled()` / absence assertion, enumerate the
  conditions under which the guarded behavior WOULD have fired, and require every one that
  lives in a shared harness default to be asserted in the test body.
- Applies beyond `Platform.OS`: feature-flag mock defaults, `NODE_ENV`-style mode switches,
  auth-state fixtures — any shared default whose drift converts a guard into decoration.
- Codified as a `code-reviewer` Testing-checklist item (single-write owner).

## Related Files

- `client/hooks/__tests__/useNutritionLookup.labelRead.test.tsx` — the pinned silence test
  ("useNutritionLookup — error announcement").
- `test/mocks/react-native.ts` — the shared `Platform.OS` default the pin protects against.
- `client/hooks/useNutritionLookup.ts` — the hook whose deleted iOS-gated error announcer
  the test guards.

## See Also

- [A verification that scans ZERO inputs is green and meaningless](verification-that-scans-zero-inputs-is-green-and-meaningless-2026-08-07.md) — the same vacuous-green family, for verification runs.
- [A test comment must claim only what its own harness can observe](a-test-comment-must-claim-only-what-its-own-harness-can-observe-2026-08-06.md) — the sibling mock-boundary rule; both came out of the same announcer cleanup.
- [A stated invariant is not an enforced one](../conventions/a-stated-invariant-is-not-an-enforced-one-2026-08-06.md) — the general principle this specializes to negative tests.
- [Two announceForAccessibility calls in one commit collide on iOS](../logic-errors/two-announceforaccessibility-same-commit-collide-ios-2026-07-21.md) — the announce-count discipline the guarded test enforces.
