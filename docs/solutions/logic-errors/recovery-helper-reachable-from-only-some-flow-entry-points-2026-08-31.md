---
title: A recovery helper reachable from only some flow entry points turns one stranded state into a whole-attempt red
track: bug
category: logic-errors
tags: [testing, maestro, e2e, react-native]
module: client
applies_to: ["e2e/**"]
symptoms: ["after one flow dies mid-registration, every later flow in the attempt fails its first wait with the same message", "hierarchy dumps at those failures show the onboarding wizard, not Sign In or Home", "only the one or two flows that call the escape helper directly recover — and everything after them passes"]
created: 2026-08-31
severity: high
---

# A recovery helper reachable from only some flow entry points turns one stranded state into a whole-attempt red

## Problem

An XCUITest transport crash killed `complete-onboarding` 4 s after "Create
Account" (main dispatch 33341123446). The registered account had
`onboardingCompleted: false`, so every relaunch routed into the wizard — a
state with neither "Sign In" nor "Hello". The wizard-escape lived in
`ensure-logged-out.yaml`, called by exactly two flows; the other six call
`login.yaml` directly and sat at the Welcome screen until their 30 s wait
expired. Attempt 2 went 3/8 red for a state the suite already knew how to
fix.

## Symptoms

See frontmatter. The discriminator is the *order*: failures stop the moment
`auth/login` (an escape carrier) runs, and everything after it passes.

## Root Cause

Recovery was attached to the flows that *cause* the state (register/logout)
instead of the entry point every flow shares. Any flow can *inherit* the
state — the suite does not clear app state between flows by design — so
recovery has to be reachable from every entry. A second wrong assumption
compounded it: the header claimed a relaunch resets the wizard to Welcome.
A local drill (kill at screen 4/8, relaunch) proved the wizard **resumes at
the stranded screen** — position persists — so a Welcome-only escape would
not have worked even where it was reachable.

## Solution

`login.yaml` (the shared entry helper) front-runs the recovery, gated so the
happy path pays nothing:

```yaml
- runFlow:
    when:
      visible: "(Get Started|Go back)"
    file: ensure-logged-out.yaml
```

`ensure-logged-out` escapes the wizard from any depth (one linear pass of
optional skip/none taps with interleaved "Continue" taps for
selection-flipped screens), logs out through the real Sign Out control, and
exits on Sign In — then the normal credential block signs in as the intended
user. Drill-verified: stranded app → `view-item-detail` recovered end-to-end
and passed; happy path logged the gate as SKIPPED.

## Prevention

- Put recovery in the helper *every* flow runs first, not in the flows that
  create the bad state.
- Document the positional precondition: the gate's markers are unambiguous
  only immediately post-launch ("Go back" is also a back-button label on
  several capture/review screens), so the helper must stay the first step
  after `launch-app.yaml`.
- Verify state-reset assumptions with a kill drill, not by reasoning about
  React Navigation — persistence surprised us here.

## Related Files

- `e2e/helpers/login.yaml` — the gated recovery + precondition comment
- `e2e/helpers/ensure-logged-out.yaml` — escape + logout; header now states
  the resume-mid-wizard fact

## See Also

- [never-clearstate-against-the-expo-dev-client](../conventions/never-clearstate-against-the-expo-dev-client-2026-08-30.md) — why state is inherited between flows in the first place
- [shared-macos-ci-runner-prewarm-bundle-budget-driver-pin-tool](../best-practices/shared-macos-ci-runner-prewarm-bundle-budget-driver-pin-tool-2026-08-31.md) — the infra kills that create these strands
