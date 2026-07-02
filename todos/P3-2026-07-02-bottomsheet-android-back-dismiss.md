<!-- Filename: P{0-3}-YYYY-MM-DD-short-description.md  (P0=critical … P3=low) -->

---

title: "Android hardware back should dismiss open BottomSheetModals, not navigate beneath them"
status: backlog
priority: low
created: 2026-07-02
updated: 2026-07-02
assignee:
labels: [deferred, ui-ux, android]
github_issue:

---

# Android hardware back should dismiss open BottomSheetModals

## Summary

No `BottomSheetModal` in the app wires Android's hardware back button: `@gorhom/bottom-sheet` has no built-in `BackHandler` (verified in library source), so a back press with a sheet open pops the screen (or backgrounds the app) underneath the still-open sheet. Every sheet host is affected — MealPlanHomeScreen's four sheets, HomeScreen and RecipeEntryHubScreen's import sheets, BeveragePickerSheet.

## Background

Flagged in the recipe-import phase1-v2 port review (2026-07-02). The port removed RecipeEntryHubScreen's `ActionSheetIOS`/`Alert.alert` photo flow, which WAS natively back-dismissible on Android, so the hub specifically regressed — but the gap is pattern-wide and pre-existing everywhere else, hence a systemic fix rather than an inline patch.

## Acceptance Criteria

- [ ] With any bottom sheet open, Android hardware back dismisses the sheet and consumes the event (no simultaneous navigation)
- [ ] With no sheet open, back behaves as before
- [ ] Implemented once at a shared level (e.g. a `useSheetBackHandler(ref, isOpen)` hook or a wrapper component), not copy-pasted per host
- [ ] Verified on the Android emulator across at least MealPlanHomeScreen (effect-presented) and HomeScreen (imperatively presented) sheets

## Implementation Notes

- `BackHandler.addEventListener("hardwareBackPress", …)` returning `true` while the sheet is presented; hosts using imperative present (no open-state) need the handler keyed on the modal's `onChange`/`onDismiss` lifecycle or a small isOpen ref.
- Consider gorhom's `enableHandlePanningGesture`/`onChange` to track presented state without adding React state to imperative hosts.

## Dependencies

- None.

## Risks

- Back-handler ordering with React Navigation's own back handling — register/unregister tightly around sheet visibility to avoid swallowing legitimate back presses.

## Updates

### 2026-07-02

- Initial creation from phase1-v2 port review (rn-ui-ux-specialist WARNING).
