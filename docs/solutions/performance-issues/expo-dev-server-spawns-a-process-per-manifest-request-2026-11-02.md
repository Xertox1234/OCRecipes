---
title: Expo's dev server starts a Node process on every manifest request — under CI load the iOS dev client times out at 10s
track: bug
category: performance-issues
module: shared
severity: medium
tags: [harness, testing, e2e, maestro, expo, ci, performance, patch-package]
symptoms: [iOS E2E flows fail in launch-app.yaml before any test step, Simulator shows "There was a problem loading the project" / "Failed to load app from http://localhost:8081 with error: The request timed out.", metro-probe.log manifest times of 10-30s while /status stays under 0.4s, A different flow fails each night and the per-flow retry stops absorbing it]
applies_to: [e2e/helpers/launch-app.yaml, .github/workflows/e2e-regression.yml, patches/**, scripts/ci/__tests__/**]
created: '2026-11-02'
---

# Expo's dev server starts a Node process on every manifest request — under CI load the iOS dev client times out at 10s

## Problem

The nightly iOS E2E run went red on 2026-11-01 and 11-02, the first two
nights after the SDK 58 upgrade (#1633). In both, one flow failed on both
attempts inside `e2e/helpers/launch-app.yaml`, before any test step ran.

## Symptoms

- The debug screenshot is the dev client's error screen, "Failed to load app
  from http://localhost:8081 with error: The request timed out."
- In `metro-probe.log` (logs-ios artifact), manifest requests over 10s went
  from 3.4% (Oct 31, SDK 57) to 19.6% and 14.9%. `/status` stayed fast.
- A different flow fails each night. Each one is a launch failure, not a
  failed assertion in the flow itself.

## Root Cause

On every manifest request, `@expo/cli` (`ExpoGoManifestHandlerMiddleware` →
`resolveRuntimeVersionWithExpoUpdatesAsync`) spawns
`expo-updates runtimeversion:resolve` as a new Node process. It does this even
when `runtimeVersion` is a literal string (ours is `"5.0.0"`), so no config
change avoids it. The iOS dev launcher waits a fixed 10s for the manifest.

The spawn costs 0.12s on an idle laptop. On the 3-CPU macos-26 runner at a
load average of 250+, each new process waits for CPU and loads its modules
from disk, and it can take more than 10s.

SDK 58 did not make the spawn slower. It made the runner busier more often.
At the same load, latency was unchanged (load 150-250: mean 3.5s on SDK 57,
3.4s on SDK 58). The share of samples at load ≥250 rose from 15% to 46-52%.

## Solution

`patches/expo++@expo+cli+<version>.patch` caches the resolve per
(projectRoot, platform). Concurrent requests share one promise, and a
rejection is evicted, not cached (#1699). Restart the dev server after
changing `runtimeVersion`.

Result on the PR's E2E dispatch (run 41530860826): manifests over 10s went
from 14.9-19.6% to 0.4%, and at load ≥250 (51% of samples) the mean went from
~7s to 0.5s. There were no timeout screens.

`scripts/ci/__tests__/expo-cli-runtime-version-cache.test.ts` loads the real
nested CLI file and swaps its `expoUpdatesCli` dependency through
`require.cache`. It fails if the patch is not applied. patch-package exits 0
on a failed apply unless `CI=true`, so without this test an `expo` bump would
drop the patch silently.

## Prevention

How to diagnose a CI timing flake:

1. **Compare at equal load before blaming code.** Bucket the probe samples by
   load average. If latency per bucket is unchanged and only the time spent in
   the high-load bucket grew, the code did not get slower. The machine is
   busier, so remove work the server does per request.
2. **Use a cheap endpoint as a control.** `/status` and the manifest share
   one event loop. If `/status` is fast while the manifest is slow, the
   handler is waiting on something outside the loop: a child process, I/O or
   the network. Slow in-process code would stall both.
3. **Laptop timings don't judge a CI fix.** Here the spawn cost 0.12s locally.
   Judge the fix with the same probe log on a CI run that is just as loaded.
4. **A test guards each patch-package patch.** A version bump otherwise drops
   the patch with no error.
5. At each SDK upgrade, regenerate the patch with
   `npx patch-package expo/@expo/cli`, or delete it if upstream caches the
   resolve.

## Related Files

- `patches/expo++@expo+cli+58.1.17.patch`
- `scripts/ci/__tests__/expo-cli-runtime-version-cache.test.ts`
- `e2e/helpers/launch-app.yaml` (notes 5 and 6)
- `.github/workflows/e2e-regression.yml` ("Keep Metro manifest warm",
  which writes metro-probe.log)

## See Also

- `docs/solutions/runtime-errors/metro-started-before-native-dependency-upgrade-crashes-dev-build-2026-11-02.md`
