---
title: "GoalSetup Calculate button jumps when the 'Still needed' hint disappears"
status: done
priority: low
created: 2026-10-12
updated: 2026-10-12
assignee:
labels: [deferred, ui]
github_issue:
---

# GoalSetup Calculate button jumps when the hint disappears

## Summary

PR #1417 added a "Still needed: …" line under GoalSetup's Calculate button. The line is removed the moment the last field is filled, so the content above it shifts and the button moves under the user's finger.

## Background

Seen in the simulator check of PR #1417. The last choice ("Maintain Weight") was tapped, the hint vanished, the button moved, and the next tap on Calculate missed it. A user who taps quickly, or who uses Switch Control or Voice Control, can hit the same thing.

## Acceptance Criteria

- [x] Completing the form does not move the Calculate button. Either the hint keeps its space (for example, replaced by an empty line of the same height) or its removal no longer shifts the button.
- [x] Checked in the simulator.

## Implementation Notes

- `client/screens/GoalSetupScreen.tsx`: the `missingFields` hint under the Calculate `Button`, and the `calculateButton`/`calculateHint` styles.

## Scope Contract

- **Mechanisms to use:** existing styles only.
- **Files in scope:** `client/screens/GoalSetupScreen.tsx` and its `__tests__`.
- No new mechanisms.

## Dependencies

- None.

## Updates

### 2026-10-12

- Filed while reviewing PR #1417.

### 2026-10-12 (fixed)

- Cause: the hint sits below the button, so removing it only moved the button through the scroll position. At the bottom of the scroll, the shorter page made the ScrollView clamp its offset, and everything shifted down (about 40px in the simulator).
- Fix: the line is always rendered and reads "Ready to calculate" once the form is complete. Measured with accessibility frames at the bottom of the scroll, the button stays at y 712.0 before and after the last pick.
