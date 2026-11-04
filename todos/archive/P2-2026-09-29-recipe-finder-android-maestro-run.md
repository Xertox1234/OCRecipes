---
title: "Recipe finder: run the manual Maestro flow on Android (parked)"
status: done
priority: medium
created: 2026-09-29
updated: 2026-11-02
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

- [x] The flow passes on Android — run on a real device (Galaxy A37, Android 16) instead of an
      emulator: `maestro --device <adb serial> test -e USERNAME=demo -e PASSWORD=… e2e/manual/recipe-finder.yaml`
- [x] Record the run (steps completed / failed) and any Android-only selector changes — see Updates.

## Implementation Notes

- Server: `RECIPE_FINDER_ENABLED=true npm run server:dev` (+ `SPOONACULAR_API_KEY`).
- Emulator: `adb reverse tcp:8081 tcp:8081` AND `adb reverse tcp:3000 tcp:3000` (the bundle's API
  domain is localhost:3000, which on the emulator is the emulator itself).
- Free host memory first (close the iOS simulator and other heavy apps); a cold boot
  (`-no-snapshot-load`) after a crash.
- Selectors were measured on iOS only. iOS merges a TextInput's label and placeholder
  ("Recipe request.\*"); Android may expose them differently.

## Updates

### 2026-11-02

- Owner now has an Android device; ran the flow on a Galaxy A37 (Android 16) with an SDK 58 dev
  build against the local server (`RECIPE_FINDER_ENABLED=true`, account `demo`).
- **Result: 53 steps completed, 0 failed.** Both conditional paths that matter ran: RecipeChef
  search → None of these → refine → generate → saved; Coach Pro community list → Get ideas for
  you → Make … mine → recipe opened → Close → Generate → saved.
- Android-only selector changes (all in `e2e/manual/recipe-finder.yaml`): Android's accessibility
  tree omits list content below the fold (iOS keeps it), measured 0 matches before one swipe and 2
  after. "Search with these", "Get ideas for you", "Make … mine" and Coach's "Generate" are now
  reached with `scrollUntilVisible`. The Coach section folds the dashboard first: Maestro swipes
  through the screen's middle, which is the dashboard while it is open.
- Not Android-specific but found on the way: the flow's "Search Spoonacular" section was stale
  since #1429 (AI-written ideas replaced it) and is rewritten for "Get ideas for you".
- Real app bug found and fixed: the Coach input sat under the keyboard on the A37 (and small
  iPhones). PR #1694.
- Dev-setup gotchas hit: a Metro started before the SDK 58 upgrade served old Worklets transforms
  and the new native build aborted at startup (`installUnpacker` → `isObject()` assertion) —
  restart Metro with `--clear` after a dependency upgrade. `adb reverse` forwards drop when wireless
  adb reconnects; re-check them before each run.
