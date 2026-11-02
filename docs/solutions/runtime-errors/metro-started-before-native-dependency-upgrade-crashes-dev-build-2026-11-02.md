---
title: "A Metro started before a native dependency upgrade crashes the new dev build at launch — restart Metro with --clear"
track: bug
category: runtime-errors
module: client
tags: [react-native, architecture, metro, worklets, reanimated, dev-client, sdk-upgrade]
symptoms: ['A freshly built dev client aborts on launch (Android "has a bug" / "keeps stopping"; native SIGABRT, no JS red box)', "Crash tombstone: jsi.h assertion \"isObject()\" failed in worklets::UnpackerLoader::installUnpacker", 'Same build launches fine after Metro is restarted']
applies_to: ['package.json', 'client/**/*.ts', 'client/**/*.tsx']
created: '2026-11-02'
severity: medium
---

# A Metro started before a native dependency upgrade crashes the new dev build at launch — restart Metro with --clear

## Problem

A dev client built after the SDK 58 upgrade (#1633: Worklets 0.10.1 → 0.13.0, Reanimated 4.5.1 → 4.7.1,
RN 0.88) aborted every launch on a Galaxy A37. The Metro serving it had been running since the day BEFORE the
upgrade.

## Symptoms

- Native abort during startup, before any app screen. `adb logcat -b crash`: `Fatal signal 6 (SIGABRT)` in
  thread `mqt_v_js`, abort message `jsi.h:2014: … Value::getObject … assertion "isObject()" failed`.
- Backtrace frames in `libworklets.so`: `UnpackerLoader::installUnpacker` → `WorkletRuntime::init` →
  `WorkletsModule::startCpp`.

## Root Cause

Worklets is split: a Babel plugin (run by Metro) emits the worklet unpacker code into the bundle, and the
native module evaluates that code at startup and expects an object back. Metro keeps its Babel transforms in
memory and in its transform cache for its whole life, so a `node_modules` upgrade under a running Metro does
not reach the bundle. The new 0.13.0 native side evaluated code from the 0.10.1 plugin, got a non-object, and
the JSI assertion aborted the process.

## Solution

Restart Metro with a cleared cache, then cold-launch the app:

```bash
kill "$(lsof -tiTCP:8081 -sTCP:LISTEN)"         # the LISTEN pid, not an npm parent
npx expo start --dev-client --port 8081 --clear   # no CI=1 — that disables file watching
```

Measured: the same APK launched cleanly to sign-in, 0 crashes, after the `--clear` restart.

## Prevention

- After any dependency or SDK upgrade, restart Metro with `--clear` before testing a new native build.
- Diagnose a launch-time native abort by comparing Metro's start time (`ps -o lstart -p <pid>`) with the
  last `package-lock.json` change (`git log -1 -- package-lock.json`). A Metro older than the lockfile is
  the first suspect.
- Release/preview builds embed their own bundle and cannot hit this; it is a dev-loop failure only.

## Related Files

- `package.json` — `react-native-worklets`, `react-native-reanimated`
- `babel.config.js` — `react-native-reanimated/plugin` (Reanimated 4 delegates to the Worklets plugin)

## See Also

- [vision-camera-zoom-prop-requires-worklets-package](vision-camera-zoom-prop-requires-worklets-package-2026-07-14.md) — another Worklets runtime failure
