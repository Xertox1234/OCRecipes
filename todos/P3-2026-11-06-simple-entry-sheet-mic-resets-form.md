---
title: "SimpleEntrySheet: pressing the mic re-runs the open/reset effect"
status: backlog
priority: low
created: 2026-11-06
updated: 2026-11-06
assignee:
labels: [deferred, mobile, voice]
github_issue:
---

# SimpleEntrySheet: pressing the mic re-runs the open/reset effect

## Summary

While the sheet is open, starting or stopping dictation resets servings to 1, clears the error and the adding state, and briefly blanks the dish name (the transcript then overwrites it).

## Background

Found by the react-hooks/set-state-in-effect batch B (PR #1770, 2026-11-06), which deliberately kept behaviour identical. The open/reset effect in `client/components/meal-plan/SimpleEntrySheet.tsx` depends on `[mealType, isListening, stopListening]`, so it re-runs on every listening change, not only on open. It sits in the voice flow that already has an owner phone check pending (#1735/#1739, memory `project_voice_field_phone_check_2026_11_05.md`).

## Acceptance Criteria

- [ ] A test pins that toggling dictation while the sheet is open keeps servings, error and dish name.
- [ ] The reset runs only when the sheet opens (or the meal type changes), not on listening changes.
- [ ] Stopping speech on close still happens.

## Implementation Notes

- File: `client/components/meal-plan/SimpleEntrySheet.tsx` (open/reset effect, kept with an eslint-disable in #1770) and `client/components/meal-plan/__tests__/`.
- Split the "stop listening when closing" part from the "reset on open" part; key the reset on the open transition.

## Scope Contract

- **Files in scope:** `client/components/meal-plan/SimpleEntrySheet.tsx` and its co-located tests.
- No new mechanisms, files, or abstractions beyond those listed.

## Updates

### 2026-11-06

- Filed from the set-state-in-effect batch B report.
