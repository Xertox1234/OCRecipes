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

Use the **positive signal for the environment itself** — here `__DEV__`, which the
bundler resolves to a literal and which no runtime state can contradict:

```ts
if (isDevelopment) {          // __DEV__, passed in as plain data
  // nothing below is meaningful on a dev build
} else if (!isEnabled) {
  // updates compiled out — a narrower, honest claim
} else if (isEmbeddedLaunch) {
  ...
}
```

The capability flag keeps a role — it just gets a narrower, truthful one ("updates
compiled out") instead of standing in for "development".

### The first fix was the same mistake again

The original correction here was **not** `__DEV__`. It was:

```ts
} else if (!isEmbeddedLaunch && !updateId) {   // "must be Metro"
```

reasoned as "a packaged build always has one or the other, so neither means nothing
was packaged." That is *another proxy* — it infers identity from absent evidence
rather than reading it. Code review killed it on two counts:

1. **It can be wrong in the other direction.** Any state reporting neither flag — a
   fetched-but-not-yet-launched update, an unresolved launch source at startup —
   makes a *shipped store binary* tell a real user it is a development build.
2. **It left a sibling bug standing.** `expo-updates` documents `channel` as always
   `null` on Expo Go and development builds, which "can run any updates compatible
   with their native runtime". A separate branch read null-channel as "this build can
   never receive an OTA" — a false hard *never* aimed exactly at the dev-build testers
   most likely to be reading it. Ordering `__DEV__` first fixed that branch for free,
   because a dev build no longer reaches it.

The lesson is not "pick a better proxy." It is that **a proxy for identity keeps
producing this bug class until it is replaced by identity.** The second attempt felt
more rigorous than the first and was still the same error, which is why the review
catch matters more than the reasoning did.

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
- To identify an environment, use the signal that *is* the environment (`__DEV__`,
  an explicit build-variant constant) — not a value you reason must accompany it.
  "A implies B, so B implies A" is where the second attempt above went wrong.
- Order the environment check **first**. Once a dev build is claimed by its own
  branch, every downstream branch may assume a release build, which lets those
  branches make strong claims (like a permanent "never") that would be false
  otherwise.
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
