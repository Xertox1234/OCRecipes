---
title: 'E2E iOS: the scan FAB tap is sometimes lost ("Photo Food Log" not found on attempt 1)'
status: backlog
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

- [ ] Every "Open scan menu" tap in `e2e/flows` checks that the menu opened ("Photo Food Log" or another menu-only element visible) and re-taps a bounded number of times if not, then fails loudly.
- [ ] Two consecutive `workflow_dispatch` runs show no scan-menu step failing attempt 1 on iOS, counted from each flow's `commands.json`, with how many re-taps happened.

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
