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
  [0]=title, [1]=button — was the empirically verified confirm on BOTH
  platforms at the time. **Retired 2026-09-05 (#908):** that app-owned alert
  proved unreliable in the opposite direction on CI — rendered on screen but
  ABSENT from the hierarchy — and was replaced by an in-app sheet with a
  unique "Yes, Sign Out" label; also, Maestro's `index` sorts by y/x bounds,
  not tree order, so the [0]/[1] stability depended on the suppressed-tree
  geometry. Index disambiguation remains a last resort for SYSTEM dialogs
  only, which cannot be migrated in-app.

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
- `e2e/helpers/ensure-logged-out.yaml` — formerly the `index: 1` alert confirm; now taps the in-app sheet's unique "Yes, Sign Out" label (see the 2026-09-05 note above)

## See Also

- [ios-sim-secure-fields-swallow-synthetic-input](ios-sim-secure-fields-swallow-synthetic-input-2026-08-30.md) — the AutoFill cousin that is NOT visible even in-test
- [An app-owned native alert can render on screen while absent from the a11y hierarchy](app-alert-renders-on-screen-but-absent-from-a11y-hierarchy-2026-09-05.md) — the inverse signature (alert missing from the dump, app tree present) and why app-owned confirms moved in-app
