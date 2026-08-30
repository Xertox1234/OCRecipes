---
title: An iOS system dialog REPLACES the app's accessibility hierarchy — readiness gates must match dialog text, and same-named siblings need index disambiguation
track: bug
category: logic-errors
tags: [testing, react-native, maestro, e2e, ios]
module: client
applies_to: ["e2e/**"]
symptoms: ["every element wait fails while a screenshot shows the app rendered fine behind a small dialog", "a whole run's flows fail near-identically after one login/registration submit", "a tap on a dialog button 'completes' but the dialog stays open (title/button same text)"]
created: 2026-08-30
severity: high
---

# An iOS system dialog REPLACES the app's accessibility hierarchy — readiness gates must match dialog text, and same-named siblings need index disambiguation

## Problem

After a password submit, iOS's "Save Password?" dialog appeared and LINGERED
across subsequent flows. While any system alert is up, Maestro's iOS
hierarchy contains ONLY the dialog — the app's entire tree is absent — so
every app-element wait times out and unrelated flows fail with identical
signatures (this poisoned nearly a whole CI attempt before diagnosis).

## Symptoms

See frontmatter. The discriminator: dump the hierarchy at the failure — if it
holds only dialog strings plus the status bar, a system dialog owns the
screen.

## Root Cause

System alerts live in a separate window that takes over the accessibility
snapshot; the app hierarchy is not merely covered, it is **gone** from the
query. Consequences:

- A launch/readiness gate whose alternation lists only app states can never
  progress past a lingering dialog — the gate itself must include the
  dialog's text (`Not Now`, the alert message, etc.) so the flow can see and
  dismiss it.
- Within one alert, same-named nodes collide: the app's Sign-Out confirmation
  alert titles itself "Sign Out" AND its confirm button is "Sign Out"; the
  title precedes the button, so a bare `tapOn: "Sign Out"` hits the
  non-interactive title (observed: alert stays open). A `below:`-anchored tap
  ALSO failed on iOS 26. `tapOn: { text: "Sign Out", index: 1 }` —
  [0]=title, [1]=button — is the empirically verified confirm on BOTH
  platforms (order is stable precisely because the dialog suppresses
  everything else).

## Solution

- Every post-launch readiness gate alternation includes the dismissable
  overlay states: `(…|Not Now|Are you sure you want to sign out.*)` — see
  `e2e/helpers/launch-app.yaml`.
- Dismissals are gated `runFlow when:` blocks so they no-op when absent.
- Alert confirms that share text with the alert title use `index: 1`.

## Prevention

When a flow's step submits credentials or triggers any OS-level prompt, the
NEXT wait must tolerate the prompt (alternation) and a gated dismissal must
follow. When tapping inside an alert, check whether the tap text also appears
as the alert's title.

## Related Files

- `e2e/helpers/launch-app.yaml` — the readiness-gate alternation
- `e2e/helpers/login.yaml` — post-submit `(Hello.*|Not Now)` wait + gated tap
- `e2e/helpers/ensure-logged-out.yaml` — the `index: 1` alert confirm

## See Also

- [ios-sim-secure-fields-swallow-synthetic-input](ios-sim-secure-fields-swallow-synthetic-input-2026-08-30.md) — the AutoFill cousin that is NOT visible even in-test
