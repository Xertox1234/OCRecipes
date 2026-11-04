---
title: Maestro's retry and optional catch only MaestroException — a failed openLink or stopApp on iOS passes straight through
track: bug
category: logic-errors
module: shared
severity: medium
tags: [testing, harness, e2e, maestro, ios, ci]
symptoms: [A flow fails on "Simulator device failed to open exp+ocrecipes://... Operation timed out" (NSPOSIXErrorDomain 60) inside a retry block, maestro.log shows one attempt and no "Attempt 1 failed for retry command" line, The failed command's error starts "kotlin.Unit java.lang.IllegalStateException"]
applies_to: [e2e/**]
created: '2026-11-02'
---

# Maestro's retry and optional catch only MaestroException — a failed openLink or stopApp on iOS passes straight through

## Problem

`e2e/helpers/launch-app.yaml` wrapped its iOS launch (stopApp + openLink) in
`retry: maxRetries: 2` (#1597, 2026-10-28) to absorb a `simctl openurl`
timeout. On nightly 41412869659 the timeout came back. The retry never re-ran:
the flow failed 26s in, after one attempt.

## Symptoms

- The command error is `kotlin.Unit java.lang.IllegalStateException: An error
  was encountered processing the command (domain=NSPOSIXErrorDomain, code=60):
  Simulator device failed to open ...`.
- `maestro.log` has a single "Stopping app" / "Opening link" pair and no
  "Retrying the commands" insight.

## Root Cause

In Maestro 2.9.0 (pinned in CI) through 2.12.1 (latest on 2026-11-02):

- `Orchestra.retryCommand` catches `MaestroException` only. Its comment says
  driver transport failures "propagate naturally".
- The subflow runner turns only a `MaestroException` into a warning for
  `optional: true`. Any other `Throwable` fails the flow.
- `IOSDriver.openLink` is `iosDevice.openLink(link).expect {}`. A failed
  `xcrun simctl openurl` therefore surfaces as a plain exception from the
  `Result`, not a `MaestroException`. `stopApp` is a bare
  `xcrun simctl terminate` and fails the same way.

So no YAML wrapper (`retry`, `optional`, nested `runFlow`) can recover from a
driver-level failure. Only an element or assertion failure is retryable.

The device-side trigger, from that run's simulator log: `simctl terminate`
signals the app and returns. The old scene was still being torn down 12s
later, LaunchServices logged "timeout waiting for launch", and the app came up
a second later on the dev launcher home without the link.

## Solution

The dead `retry` wraps were removed from `launch-app.yaml`, and its note 6 now
states the mechanism. The recovery is one level up:
`scripts/ci/e2e-with-flow-retry.sh` re-runs a failed flow once. The night went
red only because that flow's first attempt had already died of the manifest
timeout fixed in #1699. Observed rate: 1 in ~54 flow runs over four saved
nights.

## Prevention

- Before relying on `retry` or `optional:`, check which exception the wrapped
  command throws. On iOS, openLink and stopApp (verified in the 2.9.0
  source) fail outside `MaestroException`; check the driver source for any
  other OS-facing command before wrapping it.
- Verify a retry wrap by finding "Attempt 1 failed for retry command" in a
  real `maestro.log`, not by the wrap's presence.

## Related Files

- `e2e/helpers/launch-app.yaml` (note 6)
- `scripts/ci/e2e-with-flow-retry.sh`

## See Also

- `docs/solutions/performance-issues/expo-dev-server-spawns-a-process-per-manifest-request-2026-11-02.md` (lands with #1701)
