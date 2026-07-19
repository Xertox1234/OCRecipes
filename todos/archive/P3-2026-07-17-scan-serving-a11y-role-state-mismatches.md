---
title: "Fix pre-existing a11y role/state mismatches on torch toggle and serving chips"
status: done
priority: low
created: 2026-07-17
updated: 2026-07-19
assignee:
labels: [deferred, accessibility]
github_issue:
---

# Fix pre-existing a11y role/state mismatches on torch toggle and serving chips

## Summary

Two pre-existing accessibility semantics issues surfaced during the PR #661
review (both predate that branch and were left untouched by it).

## Background

Flagged by the mobile-reviewer during the Nutrition & Scan redesign review as
context notes, not new defects:

1. The ScanScreen torch button uses `accessibilityRole="button"` with
   `accessibilityState={{ checked: torchEnabled }}` — `checked` belongs to
   checkbox/switch/radio roles; on a button TalkBack may not convey the state.
2. The Serving Size chip row in ServingControls uses `accessibilityRole="button"`
   - `accessibilityState={{ selected }}` per chip with no `role="radiogroup"`
     wrapper. docs/rules/accessibility.md's radio-chip-row rule calls for radio
     semantics with a radiogroup wrapper for mutually-exclusive chip rows.

## Acceptance Criteria

- [x] Torch control announces its on/off state correctly on both VoiceOver and
      TalkBack (e.g. switch role + `checked`, or button + state in the label).
- [x] Serving chips use `accessibilityRole="radio"` +
      `accessibilityState={{ selected }}` inside a `role="radiogroup"` wrapper
      (shared `Chip` already accepts `accessibilityRole="radio"`).
- [x] docs/rules/accessibility.md rules re-checked for both changes.

## Implementation Notes

- `client/screens/ScanScreen.tsx` — torch `TouchableOpacity` (bottom controls).
- `client/components/ServingControls.tsx` — chip row `ScrollView`
  (`contentContainerStyle={styles.servingChips}`); the wrapper needs the
  radiogroup role, chips switch from button→radio.
- `client/components/Chip.tsx` supports `accessibilityRole="radio"` already.
