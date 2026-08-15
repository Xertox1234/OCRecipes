---
title: A build-time capability flag does not identify the runtime environment — branch on observed identity instead
track: bug
category: logic-errors
module: client
severity: medium
tags: [react-native, expo-updates, ota, diagnosability, environment-detection, feature-flags, dev-vs-prod, capability-flag, wrong-branch]
applies_to: [client/screens/**/*-utils.ts, client/screens/**/*.tsx, client/components/**/*.tsx]
symptoms: [A diagnostic row reports an over-the-air update in a local dev build that has never received one, An environment check keyed on an "isEnabled"/"isConfigured" flag picks the wrong branch in development, Unit tests for a branch pass while the branch never fires in the app, Expo Updates.isEnabled returns true in a Metro-served dev client, A UI branch labelled "development" only fires in configurations the developer never runs]
created: '2026-08-14'
---

# A build-time capability flag does not identify the runtime environment

## Problem

A build-diagnostics row needed to distinguish "running a dev build" from "running an
OTA update". `expo-updates` exposes `Updates.isEnabled`, which reads as exactly that
check, so the branch was written:

```ts
if (!isEnabled) {
  // "must be a dev build"
} else if (isEmbeddedLaunch) {
  // embedded bundle
} else {
  // OTA — show updateId + publish date
}
```

On the iOS Simulator, a dev client served by Metro reports:

| field | value |
|---|---|
| `Updates.isEnabled` | **`true`** |
| `Updates.isEmbeddedLaunch` | `false` |
| `Updates.updateId` | `null` |
| `Updates.channel` | `null` |

So the dev branch never fired. Control fell through to the OTA branch and the row
rendered `Bundle: OTA unknown` — **inventing an over-the-air update that does not
exist**, in the one environment a developer sees every day. On a diagnostic surface
whose entire job is answering "which bundle am I running?", that is worse than
printing nothing.

`isEnabled` reflects `EXUpdatesEnabled` in `Expo.plist` — a **build-time** value
saying the binary was *compiled to permit* updates. It says nothing about what is
actually serving the JS right now.

## Solution

Branch on **observed runtime identity**, not on a declared capability. Ask what the
running bundle actually is:

```ts
if (!isEnabled) {
  // updates compiled out — a narrower, honest claim
} else if (!isEmbeddedLaunch && !updateId) {
  // Neither an embedded bundle nor an applied update ⇒ no packaged bundle
  // at all ⇒ Metro dev server.
} else if (isEmbeddedLaunch) {
  ...
}
```

`!isEmbeddedLaunch && !updateId` is sound because a packaged build always has one or
the other: launched from its embedded bundle (`isEmbeddedLaunch`) or from a
downloaded update (`updateId`). Neither means nothing was packaged.

Note the flag keeps a role — it just gets a narrower, truthful one ("updates compiled
out") instead of standing in for "development".

## Why it matters

**A branch that only fires in configurations you never run is not covered by tests
that assert its output.** Twenty-five unit tests passed against a hand-written input
object asserting `isEnabled: false → "development build"`. Every one was green. They
tested that *given* `isEnabled: false` the copy is right — never that a dev client
actually reports `false`. The fixture encoded the same wrong assumption as the code,
so the tests could not fail.

Only running the screen surfaced it. This is the concrete form of
[`pure-utils-extraction-tests-dont-prove-wiring-2026-07-14`](../conventions/pure-utils-extraction-tests-dont-prove-wiring-2026-07-14.md):
here the wiring was correct and the *input domain* was wrong, which unit tests over a
synthetic fixture structurally cannot catch.

## How to apply

- Treat any `isEnabled` / `isConfigured` / `isAvailable` flag as **"this build may do
  X"**, never **"this is environment Y"**. They answer different questions.
- To identify an environment, prefer a value that is a *consequence* of running in it
  (a bundle id, a launch source, a served-from URL) over a value that was *declared*
  before it ran.
- When a branch is meant to fire in development, **verify it fires in development** by
  running the app — a green unit test proves the copy, not the reachability.
- When a truth table has a state that means "none of the above", write it as its own
  branch. Leaving it to fall through makes the last branch assert something it has not
  established.

## Related

- [`freshness-guard-as-emptiness-check-passes-when-partially-stale-2026-08-09`](./freshness-guard-as-emptiness-check-passes-when-partially-stale-2026-08-09.md)
  — a guard whose predicate is a proxy for the real condition.
- [`hand-copied-config-drifts-on-the-unbuilt-platform-2026-07-27`](./hand-copied-config-drifts-on-the-unbuilt-platform-2026-07-27.md)
  — the other half of the OTA-silence family: `runtimeVersion` drift.
