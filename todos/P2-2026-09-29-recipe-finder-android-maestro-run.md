---
title: "Recipe finder: run the manual Maestro flow on Android (parked)"
status: backlog
priority: medium
created: 2026-09-29
updated: 2026-09-30
assignee:
labels: [deferred, e2e, android, recipe-finder]
github_issue:
human_led: true
blocked_reason: "No Android device; Android runs parked by user ruling 2026-09-29 — pick up only when the user asks"
---

# Recipe finder: run the manual Maestro flow on Android (parked)

## Summary

`e2e/manual/recipe-finder.yaml` passed on the iOS simulator (plan Task 31). The Android run is
parked by user ruling: "I do not have an android device. We will need to park anything that
requires Android." (2026-09-29).

## Background

- The plan (`docs/superpowers/plans/2026-09-28-recipe-finder.md`, Task 31 Step 3) asks for iOS AND
  Android runs before the flag flip. iOS passed: 46 steps, 0 failed.
- The Android emulator (`Medium_Phone_API_36.1`, dev build from 2026-08-17) booted once and passed
  launch + login, then crashed. Three restarts hung at "Enabling Vulkan" under host memory pressure
  (swap 10.3 of 11.2 GB) and never registered with adb.
- Nothing in the finder client is Android-only; the shared components have unit tests on both
  platform branches. What's unverified is the end-to-end run on Android.

## Acceptance Criteria

- [ ] The flow passes on an Android emulator:
      `maestro --device emulator-5554 test -e USERNAME=<premium> -e PASSWORD=<pw> e2e/manual/recipe-finder.yaml`
- [ ] Record the run (steps completed / failed) and any Android-only selector changes.

## Implementation Notes

- Server: `RECIPE_FINDER_ENABLED=true npm run server:dev` (+ `SPOONACULAR_API_KEY`).
- Emulator: `adb reverse tcp:8081 tcp:8081` AND `adb reverse tcp:3000 tcp:3000` (the bundle's API
  domain is localhost:3000, which on the emulator is the emulator itself).
- Free host memory first (close the iOS simulator and other heavy apps); a cold boot
  (`-no-snapshot-load`) after a crash.
- Selectors were measured on iOS only. iOS merges a TextInput's label and placeholder
  ("Recipe request.\*"); Android may expose them differently.
