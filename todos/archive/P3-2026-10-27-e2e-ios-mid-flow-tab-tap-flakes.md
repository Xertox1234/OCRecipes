---
title: "E2E iOS: mid-flow tab taps sometimes miss on the macos-26 runner (Settings / Browse Recipes not found on attempt 1)"
status: done
priority: low
created: 2026-10-27
updated: 2026-10-28
assignee:
labels: [deferred, testing]
github_issue:
---

# E2E iOS: mid-flow tab taps sometimes miss on the macos-26 runner

## Summary

After the app has loaded, some iOS flows fail on attempt 1 because a tab switch does not take effect in time, then pass on the per-flow retry. The retry hides it, so the nightly stays green.

## Background

Seen after the launch-timeout fixes (#1586 relaunch loop, plus the "Keep Metro manifest warm" step), once launches stopped failing:

- Run 40548172630, Onboarding: `ensure-logged-out` tapped `tab-profile`, but the screenshot still shows Home, so "Settings" was never found (step-020).
- Run 40583018319, Auth - Login flow: the same "Element not found: Settings".
- Run 40583018319, Plan - Meal plan home and pantry: "Browse Recipes" not visible within its 15s wait.

All three passed on retry. They pass on Android and passed on iOS before SDK 57 / macos-26. The runner has 3 CPUs at load average 150-290 with the iOS 26 simulator up (diagnostic run 40559576171), so the likely cause is a tap landing before the tab bar or screen is responsive. That is not measured yet.

## Acceptance Criteria

- [x] The cause of the missed `tab-profile` tap is identified from attempt-1 artifacts: screenshots and hierarchy before and after the tap.
- [x] The affected steps wait for the destination screen and re-tap if the switch didn't happen, rather than raising timeouts blindly.
- [x] Two consecutive `workflow_dispatch` runs show none of these three steps failing attempt 1 on iOS.

## Implementation Notes

- Steps: `e2e/helpers/ensure-logged-out.yaml` (the `tapOn: id: "tab-profile"` then `tapOn: "Settings"` pair) and `e2e/flows/plan/meal-plan-home.yaml` (the `extendedWaitUntil: "Browse Recipes"`, 15s).
- Artifacts: `logs-ios` of runs 40548172630 and 40583018319, `e2e/maestro-output/<flow>/screenshots/`.
- One option for the tab tap: `retry` around `tapOn tab-profile` + `extendedWaitUntil` on a Profile-only element, before tapping "Settings".

## Scope Contract

- In scope: `e2e/helpers/**`, `e2e/flows/**`.
- Out of scope: app code, `.github/workflows/**`.

## Updates

### 2026-10-27

- Filed during the iOS launch-timeout investigation (#1586 and its follow-up).

### 2026-10-28

- Cause: the tap is lost, not slow. In all three failures the tab `tapOn` reported COMPLETED (1.5-2.9s), and the failure dump 15-17s later still shows `tab-home` selected:true. Maestro dumps only on failure, so there is no before-tap hierarchy, and why the app drops the tap is not measured.
- Fix: `e2e/helpers/tap-tab.yaml` taps, waits up to 5s for `selected: true`, re-taps at most twice, then fails naming the tab. All 10 tab taps in `e2e/flows` and `e2e/helpers` use it. `e2e/manual/` is out of scope and still uses bare taps.
- Validation, per tap-tab invocation from `commands.json`:
  - Run 40604313571: iOS 11 switches, 1 re-tap (Auth Login `tab-profile`: the 5s wait warned, the re-tap switched, the flow passed attempt 1); Android 11, 0 re-taps; 0 final-gate failures.
  - Run 40614765446: iOS 12, Android 12, 0 re-taps, 0 final-gate failures.
  - Neither run had any of the three named steps fail attempt 1.
- Filed from these runs: `todos/P3-2026-10-28-e2e-ios-lost-tap-on-scan-fab.md`, `todos/P3-2026-10-28-e2e-ios-launch-ends-on-dev-launcher-home.md`.
