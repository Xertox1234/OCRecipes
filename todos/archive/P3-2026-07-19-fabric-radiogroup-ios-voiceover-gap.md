---
title: "radiogroup (and other group roles) announce nothing on iOS Fabric — decide per-role mitigation for the 13+ screens using the codified chip-row pattern"
status: done
priority: low
created: 2026-07-19
updated: 2026-07-19
assignee:
labels: [deferred, accessibility]
github_issue:
---

# `radiogroup` announces nothing on iOS Fabric — codebase-wide, inherited from the codified pattern

## Summary

The mobile-reviewer's PR #668 pre-merge pass verified against RN primary source that
Fabric's role→VoiceOver mapping (`RCTViewComponentView.mm` `accessibilityValue` getter,
~lines 1265-1334) special-cases only `checkbox` and `radio` — `radiogroup` is absent, so
the wrapper role announces nothing on iOS (this app runs Fabric: `app.json` / `ios/Podfile.properties.json`
set `newArchEnabled: true`). Android is unaffected (`ReactAccessibilityDelegate.java`
handles `RADIOGROUP` via `setRoleDescription`). Every screen following
`docs/solutions/design-patterns/radio-checkbox-group-container-pattern-2026-05-13.md`
inherits the gap.

## Background

Found during the PR #668 review (serving-chip radiogroup). Practical impact is small —
each chip still announces "[label], radio button, selected/not selected" via its own
`radio` role + `selected` state — only the _grouping_ semantic is silently dropped on
iOS. The legacy Paper renderer had a `radiogroup` → "radio group" mapping, but that code
path explicitly does not run on Fabric. Fabric also omits `tablist` and several other
group roles, so any fix should be evaluated per-role, not radiogroup-only.

Known affected call sites (13+): `SettingsScreen.tsx:329`, `BatchSummaryScreen.tsx:325`,
`EditDietaryProfileScreen.tsx` (×5), `GoalSetupScreen.tsx` (×3),
`RecipeGenerationModal.tsx` (×2), `PreparationPicker.tsx:51`,
`client/components/ServingControls.tsx:106` (PR #668), plus onboarding screens.

## Acceptance Criteria

- [x] Decision recorded: mitigate (e.g. supplement the wrapper with an
      iOS-audible grouping cue such as a positional "x of y" in each chip's label or an
      `accessibilityLabel` on a true accessibility element) or accept-and-document the
      iOS asymmetry in `docs/rules/accessibility.md` + the codified pattern doc
      — **accept-and-document** chosen, for the whole group-role class
      (`radiogroup`, `tablist`, etc.), not radiogroup alone.
- [x] If mitigated: applied uniformly via the shared pattern (one mechanism, not
      per-screen hand edits), with a test pinning the chosen behavior — N/A,
      accept-and-document was chosen, not mitigate.
- [x] `docs/solutions/design-patterns/radio-checkbox-group-container-pattern-2026-05-13.md`
      and `docs/rules/accessibility.md` updated to match the decision

## Implementation Notes

- Primary-source evidence:
  `node_modules/react-native/React/Fabric/Mounting/ComponentViews/View/RCTViewComponentView.mm:1265-1334`
  (Fabric mapping, no `radiogroup`);
  `node_modules/react-native/React/Views/RCTView.m:294-349` (legacy mapping with
  `radiogroup`, comment states it does not run on Fabric);
  `node_modules/react-native/ReactAndroid/src/main/java/com/facebook/react/uimanager/ReactAccessibilityDelegate.java:406-407`
  (Android handles it).
- Per-chip semantics are already correct on both platforms — do NOT change chip
  role/state as part of this; the question is only the group-level cue on iOS.
- VoiceOver verification needs a device/simulator pass; TalkBack via the emulator
  logcat-speech method (see `reference_talkback_emulator_verification` memory note).

## Dependencies

- None.

## Risks

- Positional labels ("1 of 3") duplicate what VoiceOver's own container navigation
  sometimes provides; verify with a real VoiceOver pass before adopting, or the cue
  reads twice.
