---
title: 'E2E iOS: launch-app sometimes ends on the dev launcher''s "Searching for development servers" home'
status: backlog
priority: low
created: 2026-10-28
updated: 2026-10-28
assignee:
labels: [deferred, testing]
github_issue:
---

# E2E iOS: launch-app sometimes ends on the dev launcher home

## Summary

Some iOS flows fail attempt 1 inside `e2e/helpers/launch-app.yaml` with the simulator on the expo-dev-launcher home screen ("DEVELOPMENT SERVERS", "Searching for development servers..."), not the app and not the "There was a problem loading the project" error screen. The per-flow retry passes, so the nightly stays green.

## Background

Seen after the keep-warm step (#1587) and the relaunch loop (#1586) were in place:

- Run 40604313571: Scan - Barcode scanning flow and Scan - Photo analysis intent selection. The relaunch `repeat` ran (about 50s), its `openLink`s all reported COMPLETED, then the final readiness gate failed with the launcher home in the dump (step-023).
- Run 40614765446: Home - View item detail from history. The first `openLink` itself FAILED after 15.8s; the dump (step-008) shows the launcher home.

The readiness regex does not list the launcher home, and the relaunch loop only fires on the error screen, so this state gets no recovery. Why the deep link lands on the launcher instead of loading the bundle is not measured. Candidates: the `openLink` arriving before the dev client handles URLs, or the launcher's own server discovery taking over.

## Acceptance Criteria

- [ ] The cause is identified from attempt-1 artifacts (`commands.json` timings, dumps, `xctest_runner_*.log`, Metro log around the `openLink`).
- [ ] launch-app recovers from the launcher home (for example, the gate accepts "Searching for development servers.\*" and the bounded relaunch loop covers it), or the cause is fixed directly.
- [ ] Two consecutive `workflow_dispatch` runs show no iOS flow failing attempt 1 in launch-app, counted from `commands.json`.

## Implementation Notes

- `e2e/helpers/launch-app.yaml`: readiness gate, the `repeat ... while "There was a problem loading the project.*"` loop, and header note (5).
- Artifacts: `logs-ios` of runs 40604313571 and 40614765446.
- Keep `stopApp` iOS-gated (Android uses a different app ID; see header note (5)).

## Scope Contract

- In scope: `e2e/helpers/**`, `e2e/flows/**`.
- Out of scope: app code, `.github/workflows/**`.

## Updates

### 2026-10-28

- Filed from the tab-tap fix's validation runs 40604313571 and 40614765446.
