---
title: "Smart-scan menu confirm: visible processing affordance during on-device OCR"
status: done
priority: low
created: 2026-06-23
updated: 2026-06-23
assignee:
labels: [deferred, rn-ui-ux]
github_issue:
---

# Smart-scan menu confirm: processing affordance during OCR (from PR #437 review)

## Summary

PR #437 made `onSmartPhotoConfirm` async to compute on-device MLKit OCR for the
smart-scan **menu** path (so `MenuScanResultScreen` renders its instant local
skeleton). During that ~1s OCR the "Looks right →" confirm button shows **no
processing state** — `isConfirmingRef` is a `ref`, so the tap triggers no
re-render and structurally cannot drive a spinner. The button looks idle.

Not a correctness bug: PR #437 added a post-await liveness re-check, so leaving
the screen mid-OCR is safe (it bails instead of mis-navigating). This is UX
polish only — and the added latency was accepted by design. Tracked here rather
than expanding the #437 fix into `ProductChip`.

## Background

Surfaced by the `camera-specialist` review of PR #437 (SUGGESTION). An
unresponsive-looking confirm button during a sub-second wait reads as a missed
tap and nudges users to re-tap or leave.

## Acceptance Criteria

- [ ] On the smart-scan **menu** confirm path, tapping "Looks right →" shows a
      visible pending state (disable the button + small spinner) while on-device
      OCR runs, clearing when navigation occurs or the handler bails.
- [ ] No regression to the existing `isConfirmingRef` double-tap guard.
- [ ] Pending state is announced/handled accessibly (`accessibilityState` busy
      or disabled), per `docs/rules/accessibility.md`.
- [ ] iOS + Android both verified (cross-platform requirement).

## Implementation Notes

- Driver: `client/screens/ScanScreen.tsx` `onSmartPhotoConfirm` (~line 657) +
  `isConfirmingRef` (~line 125). A `ref` can't drive a re-render — add a small
  `isConfirming` `useState` (set true on tap, false in the `finally`) to render
  the pending state. Keep `isConfirmingRef` for the synchronous re-entrancy
  guard; the state is purely for the visual.
- Only the `restaurant_menu` branch actually awaits OCR (`resolveMenuLocalOCRText`
  returns immediately for other types), so the spinner is effectively a menu-only
  affordance — fine to show it on any smart confirm tap since non-menu resolves
  instantly.
- UI: `client/camera/components/ProductChip.tsx` confirm button (~lines 225-243)
  needs a `disabled`/pending variant accepting the new flag.
- React Compiler is active — no manual memo needed for the added state.

## Dependencies

- Follows PR #437 (smart-scan menu OCR head-start). No blocking dependency once
  #437 merges.
