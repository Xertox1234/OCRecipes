---
title: On a shared macOS CI runner, pre-warm the Metro bundle and budget the driver BEFORE the first flow — three cold starts otherwise race one starved CPU
track: knowledge
category: best-practices
tags: [testing, harness, maestro, e2e, ci, ios]
module: client
applies_to: [".github/workflows/e2e-regression.yml", "e2e/**"]
created: 2026-08-31
---

# On a shared macOS CI runner, pre-warm the Metro bundle and budget the driver BEFORE the first flow — three cold starts otherwise race one starved CPU

## When this applies

Any Maestro/XCUITest suite on GitHub-hosted macOS runners, and any red streak
whose failures look like *different* one-offs each time.

## Rule

1. **Serialize the cold starts.** Before `maestro test`, fetch the dev
   client's exact bundle URL (the manifest's `launchAsset.url`, e.g.
   `/client/index.bundle?platform=ios&dev=true&hot=false&lazy=true&…`) with
   a generous `--max-time`, best-effort. Then the first flow's launch is served
   from Metro's cache instead of competing with the XCUITest driver bring-up
   and the flow's own readiness gate.
2. **Budget the driver explicitly.** `MAESTRO_DRIVER_STARTUP_TIMEOUT` defaults
   to 120000 ms (the runner's `/status` is polled every 500 ms); set 300000 on
   the iOS job. The exception text (`IOSDriverTimeoutException: iOS driver not
   ready in time`) names the knob itself.
3. **Retry steps whose side effects already succeeded.** `expo run:ios`
   builds, installs, then launches; a `simctl openurl` stall (POSIX 60) fails
   the whole step after the expensive part is done. One retry with warm
   DerivedData costs ~2-3 min; give the step its own `timeout-minutes` so a
   wedged retry fails into the diagnostic step, not the job timeout.
4. **Pin the tool.** `curl get.maestro.mobile.dev | bash` resolves "latest"
   per run — `MAESTRO_VERSION=x.y.z` pins it. Green runs upload no artifacts
   (`if: failure()`), so a green run's tool version is otherwise
   unrecoverable after the fact.
5. **Recompute the job timeout every time a budget grows** — the comment must
   carry the arithmetic, or the next bump silently reintroduces the
   ambiguous-timeout mode the headroom exists to prevent.

## Smell patterns

- Three consecutive red dispatches with three *different* simulator-layer
  errors (transport crash, launch stall, driver never ready) while the
  Android job on ubuntu stays green — that is contention, not three bugs.
- A cold-bundle time in `metro.log` 3-4× the usual (177.7 s vs 41-58 s).
- A retry pass where every flow fails in 4-6 s — the driver is dead; the
  flows never ran.

## Why

GitHub's shared macOS runners vary wildly in available CPU. Xcode 26.3 +
an iOS 26 simulator is the least-mature automation stack, and the job's
first flow triggers Metro's full 3000-module bundle, Maestro's XCTest runner
install/launch, and a 4-minute readiness wait all at once. Each red run in
the 2026-08-30/31 streak lost a different one of those races; the fix that
held was removing the race, not lengthening any single timeout. The plan's
"3 dispatches without green ⇒ stop and reassess" rule is what surfaced it.

## Exceptions

If the toolchain choice itself is in question (here Xcode 26.3 is deliberate —
four documented breaks under 16.2), the next lever after serialization is a
larger runner (`macos-15-xlarge`), which is a cost decision, not a config
tweak.

## Related Files

- `.github/workflows/e2e-regression.yml` — `Pre-warm Metro bundle` step,
  `MAESTRO_DRIVER_STARTUP_TIMEOUT`, pinned `Install Maestro`, per-step and
  job timeouts with their arithmetic
- `todos/archive/P2-2026-08-30-e2e-flow-assertions-dont-match-app-ui.md` —
  the dispatch-14/15/16 evidence chain

## See Also

- [diagnose-e2e-from-debug-output-artifacts-first](diagnose-e2e-from-debug-output-artifacts-first-2026-08-30.md) — how each of the three modes was identified without guessing
- [recovery-helper-reachable-from-only-some-flow-entry-points](../logic-errors/recovery-helper-reachable-from-only-some-flow-entry-points-2026-08-31.md) — the state-side amplifier that turned one infra kill into a red attempt
