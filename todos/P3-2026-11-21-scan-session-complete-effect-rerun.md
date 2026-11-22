---
title: "The SESSION_COMPLETE effect can cancel its own navigation when one of its deps changes"
status: backlog
priority: low
created: 2026-11-21
updated: 2026-11-21
assignee:
labels: [deferred, camera, client]
github_issue:
---

# The SESSION_COMPLETE effect can cancel its own navigation when one of its deps changes

## Summary

Camera audit 2026-11-21 finding, deferred at triage by the owner. Source: `docs/audits/2026-11-21-camera.md` (local manifest).

## Background

In `client/screens/ScanScreen.tsx` (SESSION_COMPLETE effect, ~:279-350) a rerun's cleanup clears the 700 ms navigate timer and aborts the controller, then the rerun hits `if (sessionNavigatedRef.current) return;` and never restarts either. Today only a runtime reduced-motion toggle inside that 700 ms window triggers it (`refreshScanCount`, `navigation`, `haptics` are stable), leaving the user on SESSION_COMPLETE; in returnAfterLog mode the confirm card stays loading.

## Acceptance Criteria

- [ ] A dependency change during the 700 ms window still navigates exactly once
- [ ] A ScanScreen test toggles reduced motion mid-window and asserts the navigate
- [ ] Existing SESSION_COMPLETE tests stay green

## Implementation Notes

Keep the timer and AbortController in refs owned outside this effect's deps, or split the one-shot navigate into an effect keyed only on the SESSION_COMPLETE transition. Files: `client/screens/ScanScreen.tsx`, `client/screens/__tests__/ScanScreen.test.tsx`.

## Updates

### 2026-11-21

- Filed from the camera audit (deferred at triage)
