---
title: "E2E iOS: mid-flow tab taps sometimes miss on the macos-26 runner (Settings / Browse Recipes not found on attempt 1)"
status: backlog
priority: low
created: 2026-10-27
updated: 2026-10-27
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

- [ ] The cause of the missed `tab-profile` tap is identified from attempt-1 artifacts: screenshots and hierarchy before and after the tap.
- [ ] The affected steps wait for the destination screen and re-tap if the switch didn't happen, rather than raising timeouts blindly.
- [ ] Two consecutive `workflow_dispatch` runs show none of these three steps failing attempt 1 on iOS.

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
