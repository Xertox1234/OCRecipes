---
title: A validation-error row pushes the submit button under the iOS keyboard — the coordinate tap lands on the keyboard and "completes"
track: bug
category: logic-errors
tags: [testing, react-native, maestro, e2e, ios]
module: client
applies_to: ["e2e/**"]
symptoms: ["a login/submit E2E flow fails its post-submit wait while the fields are visibly populated in the hierarchy dump", "the app's own empty-field validation message is on screen together with correctly-filled inputs", "a retry oracle that retypes credentials still never leaves the form", "tap steps all report COMPLETED"]
created: 2026-09-05
severity: medium
---

# A validation-error row pushes the submit button under the iOS keyboard — the coordinate tap lands on the keyboard and "completes"

## Problem

`login.yaml`'s first submit occasionally fires with an empty username (the
`inputText` races field focus under CI contention), so the app renders
"Please fill in all fields". That inline error row inserts above the submit
button and pushes it down — from y≈491 to `[24,525][369,577]` — while the
keyboard from the password entry occupies everything from y=517 up
(`SystemInputAssistantView` [0,517][393,561] + keys below). The button is now
**entirely under the keyboard**. The retry oracle retyped both fields
correctly (run 33930429696 step-037 dump: `testuser` + 11-char password) but
its re-tap at the button's computed center (196,551) landed on the keyboard's
autofill bar; the form never re-submitted, the error never cleared, and the
30s `notVisible "Sign In"` wait failed the flow.

## Symptoms

See frontmatter. The tell in the dump: populated inputs + the empty-field
validation message + keyboard nodes overlapping the submit button's bounds.

## Root Cause

Three mechanisms compound:

1. Maestro taps an element's **hierarchy coordinates** without checking what
   is on top; a target under the keyboard receives nothing, and the tap is
   reported COMPLETED because "the UI changed".
2. An inserted error/status row **moves layout down**, so a button that was
   reachable before the failed submit is occluded after it — the failure
   creates the geometry that defeats the recovery.
3. A real user is unaffected (`KeyboardAwareScrollViewCompat` lets them
   scroll the button clear), which is why this never reproduces manually —
   it is a harness-geometry bug, not a product bug.

## Solution

Drop the keyboard before every submit tap by blurring the focused input —
tap a static, always-visible element by testID (`auth-form-subtitle`), the
suite's established idiom from `complete-onboarding.yaml`. **Not**
`hideKeyboard`: its iOS implementation is flaky and was observed
backgrounding the app. Mandatory before the primary submit; `optional: true`
inside a permissive retry loop, where the mandatory sibling anchors the
selector's liveness.

## Prevention

- Any flow that types into a field and then taps a button **lower on the
  screen** needs a keyboard-drop step between them; assume the keyboard is up
  after every `inputText`.
- When adding an inline error/status row to a form, remember it changes the
  geometry E2E flows tap by — re-check downstream taps' reachability.
- Never accept a COMPLETED tap as proof the target received it; the outcome
  assertion (screen changed to X) is the only evidence.

## Related Files

- `e2e/helpers/login.yaml` — blur-before-submit at both tap sites
- `e2e/flows/onboarding/complete-onboarding.yaml` — the original blur idiom + hideKeyboard rejection rationale
- `client/screens/LoginScreen.tsx` — `auth-form-subtitle` testID (the blur target)

## See Also

- [An app-owned native alert can render on screen while absent from the a11y hierarchy](app-alert-renders-on-screen-but-absent-from-a11y-hierarchy-2026-09-05.md) — the co-resident #908 failure mode; same underlying "tap completes without reaching the target" behavior
- [An optional Maestro step can never fail](optional-e2e-steps-cannot-fail-dead-selectors-stay-green-2026-08-30.md) — why the retry-loop blur is optional only under a mandatory sibling anchor
