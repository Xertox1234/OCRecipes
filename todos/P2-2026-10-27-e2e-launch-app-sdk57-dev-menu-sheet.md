---
title: "E2E: launch-app helper no longer closes the SDK 57 dev menu sheet (first flow fails on attempt 1)"
status: backlog
priority: medium
created: 2026-10-27
updated: 2026-10-27
assignee:
labels: [deferred, testing]
github_issue:
---

# E2E: launch-app helper no longer closes the SDK 57 dev menu sheet

## Summary

`e2e/helpers/launch-app.yaml` detects the Expo dev menu sheet by the text
`"Connected to:"` and closes it with `tapOn "Close"`. The SDK 57 dev menu is
redesigned: it shows "Runtime version: 4.0.0", Reload / Go home tiles and an
X button, with no "Connected to:" text. The sheet therefore stays open over
the login screen and the next assertion, `"(Sign In|Hello.*|Not Now)"`, fails.

## Background

Found while checking the nightly after #1582. In the Android nightly the
NutriCoach chat flow failed on 10-24, 10-26 and 10-27 (not 10-25). In
`workflow_dispatch` run 40518026548 it failed on attempt 1 and passed on the
per-flow retry (`scripts/ci/e2e-with-flow-retry.sh`), so the job concluded
`success`. The sheet shows only on the first cold connect, and flow order is
non-deterministic, so the failure lands on whichever flow happens to run first.
Evidence: artifact `logs-android` →
`e2e/maestro-output/Home - NutriCoach chat interaction/screenshots/step-018-assertCondition-(Sign_InHello.Not_Now).png`
shows the new sheet over "Welcome! Sign in to continue".

The `"Connected to:"` alternative in the 240s readiness regex in the same
helper is now a dead branch too.

## Acceptance Criteria

- [ ] The helper detects and closes the SDK 57 dev menu sheet on both platforms, using labels read from a live hierarchy dump (not guessed).
- [ ] The readiness regex no longer depends on "Connected to:" alone.
- [ ] A `workflow_dispatch` run shows no flow failing attempt 1 on the dev menu sheet (Android; iOS once its load timeout is fixed).

## Implementation Notes

- Get the new sheet's accessibility labels from the local iOS sim: the SDK 57 dev build (runtime 4.0.0, built 2026-10-25) is installed. Open the dev menu and dump the hierarchy (`maestro hierarchy`), or use the run's `screen-hierarchy` artifact.
- No Android device locally; validate Android via `workflow_dispatch` of `e2e-regression.yml`.

## Scope Contract

- **Mechanisms to use:** existing Maestro helpers in `e2e/helpers/`.
- **Files in scope:** `e2e/helpers/launch-app.yaml`, `e2e/flows/**`.
- No new mechanisms, files, or abstractions beyond those listed.

## Updates

### 2026-10-27

- Initial creation (found while checking the nightly after #1582); root cause found from run 40518026548's screenshot.
