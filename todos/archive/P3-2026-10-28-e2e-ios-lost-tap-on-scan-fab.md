---
title: 'E2E iOS: the scan FAB tap is sometimes lost ("Photo Food Log" not found on attempt 1)'
status: done
priority: low
created: 2026-10-28
updated: 2026-10-28
assignee:
labels: [deferred, testing]
github_issue:
---

# E2E iOS: the scan FAB tap is sometimes lost

## Summary

The lost-tap problem fixed for bottom tabs (`e2e/helpers/tap-tab.yaml`) also hits the floating scan button. The per-flow retry hides it, so the nightly stays green.

## Background

- Run 40614765446, Scan - Photo analysis intent selection, attempt 1: `tapOn "Open scan menu"` reported COMPLETED in 2.6s. The failure dump 10.5s later (step-027) still shows Home ("Hello testuser") and no scan menu, so `extendedWaitUntil "Photo Food Log"` failed. It passed on retry.
- Same shape as the tab taps: the action reports success and the app never reacts. On tabs, a re-tap after a short wait fixed it (run 40604313571: one rescued `tab-profile` tap).

## Acceptance Criteria

- [x] Every "Open scan menu" tap in `e2e/flows` checks that the menu opened ("Photo Food Log" or another menu-only element visible) and re-taps a bounded number of times if not, then fails loudly.
- [x] Two consecutive `workflow_dispatch` runs show no scan-menu step failing attempt 1 on iOS, counted from each flow's `commands.json`, with how many re-taps happened.

## Implementation Notes

- Call sites: `grep -rn 'Open scan menu' e2e/flows e2e/helpers`.
- Pattern to follow: `e2e/helpers/tap-tab.yaml` (tap, optional 5s wait for the result, `repeat` + `while notVisible` re-tap, final non-optional gate). A second helper taking the target and the expected element as env vars may serve both; keep `tap-tab.yaml`'s `selected` check for tabs.
- Re-tapping the FAB while the menu is already opening may close it; check that the expected element is not visible before each re-tap (the `runFlow when notVisible` guard in `tap-tab.yaml` does this).

## Scope Contract

- In scope: `e2e/helpers/**`, `e2e/flows/**`.
- Out of scope: app code, `.github/workflows/**`.

## Updates

### 2026-10-28

- Filed from the tab-tap fix's validation run 40614765446.

### 2026-10-28 (done)

- Fix: `e2e/helpers/open-scan-menu.yaml` (env `ACTION` = the menu action the flow taps next). It taps, waits up to 5s for ACTION, re-taps at most twice (each re-tap guarded by `when notVisible` and `optional`, since an opened menu relabels the FAB "Close scan menu"), then a final 5s gate. Both scan flows use it. The menu's action labels are absent from all 10 Home dumps in run 40614765446, so ACTION is a menu-only signal.
- Validation on head 9ff98ff (helper unchanged since cd25e3a), tallied from commands.json including retry attempts:
  - Run 40678946874 (cd25e3a): iOS 2 opens, 1 re-tap (Scan Barcode: first tap COMPLETED, menu still closed 9s later, opened after the re-tap); Android 2 opens, 0 re-taps.
  - Run 40690138910: iOS job red because the simulator driver dropped out ("Device became unreachable", 8 flows at 13:44) plus launch failures; the helper ran once (0 re-taps, 0 failures); Android 2/0/0.
  - Run 40707057598: green; iOS 2 opens, 0 re-taps; Android 2/0/0.
  - Total: 11 menu opens, 1 re-tap, 0 helper failures. Runs 2 and 3 had no scan-menu attempt-1 failure.
- Codified: `docs/solutions/logic-errors/maestro-tap-reports-success-but-the-app-never-saw-it-2026-10-28.md`.
