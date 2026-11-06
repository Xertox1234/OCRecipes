---
title: "E2E: 'View item detail from history' flakes on iOS when the login screen never appears"
status: done
priority: low
created: 2026-11-05
updated: 2026-11-05
assignee:
labels: [deferred, e2e]
github_issue:
---

# E2E: 'View item detail from history' flakes on iOS when the login screen never appears

## Summary

The iOS Maestro flow `e2e/flows/home/view-item-detail.yaml` sometimes fails at its login step because the login screen never shows. When it fails on both the first try and the retry, the nightly E2E job goes red.

## Background

Found while diagnosing the nightly E2E iOS red (fixed for the receipt flow in #1753). In run 41960367024 (2026-11-05, manual dispatch on `e693150`), "Home - View item detail from history" failed on both attempts at the login screen assertion. It also failed once on 2026-11-02. In the #1753 validation run (42003477050) it passed on the first try (2m 5s). It was deferred because it is a separate flake from the receipt-upload one.

Diagnosis (run 41960367024 artifacts, screenshot step-022 and its hierarchy dump): the app was signed OUT on "Welcome! Sign in to continue", with the Expo dev-client menu sheet ("Runtime version: 5.0.0", Reload, Go home, TOOLS) still covering it. `e2e/helpers/launch-app.yaml`'s gated optional `tapOn: Close` ran and reported COMPLETED (commands.json), but step-018's screenshot still shows the menu, so `login.yaml`'s 60s wait for (Sign In|Hello.\*|Not Now) saw only the menu's nodes and timed out. "Close" is present as accessibilityText in the hierarchy. The original lead (session left signed in, so add ensure-logged-out) was wrong. Attempt 2 died elsewhere (launch-app's optional "Not Now" tap still RUNNING at log end, no dump); unexplained and out of scope.

## Acceptance Criteria

- [ ] The PR states the observed screen (dev menu over the signed-out Welcome screen; see Background).
- [ ] `e2e/helpers/launch-app.yaml` closes the dev menu verified: a bounded `repeat` (max 3) `while: visible: "Runtime version.*"` taps Close (optional) and then waits up to ~3s for `notVisible: "Runtime version.*"` (optional); header note (7) records the run id and evidence.
- [ ] A workflow_dispatch run of E2E Regression passes on iOS.

## Implementation Notes

- Debug artifacts: `gh run download 41960367024 -n logs-ios`. The flow's dumps are under `e2e/maestro-output/Home - View item detail from history*`.
- `scripts/ci/e2e-with-flow-retry.sh` re-runs a failed flow once on its own. A cause that persists into the retry (such as a session left signed in) fits both attempts failing.

## Scope Contract

- **Mechanisms to use:** existing Maestro commands only (`repeat`/`while`, `tapOn`, `extendedWaitUntil` with `notVisible`).
- **Files in scope:** `e2e/helpers/launch-app.yaml` and this todo file. Do not touch `view-item-detail.yaml`.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- The tap may fail for a reason the dumps do not show; the loop is bounded at 3 rounds and a surviving menu still fails loud at the next wait.

## Updates

### 2026-11-05

- Initial creation (deferred from the nightly E2E diagnosis; receipt flow fixed in #1753)
- Re-scoped after diagnosis: dev menu left open, not a signed-in session; fix is a verified Close loop in launch-app.yaml
