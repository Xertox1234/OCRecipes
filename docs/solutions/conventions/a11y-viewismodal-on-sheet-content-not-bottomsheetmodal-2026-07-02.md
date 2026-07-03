---
title: accessibilityViewIsModal must go on the sheet's content View — BottomSheetModal typechecks but never forwards it
track: knowledge
category: conventions
module: client
tags: [accessibility, gorhom-bottom-sheet, bottom-sheet, voiceover, react-native]
symptoms: [VoiceOver can swipe out of an open bottom sheet into the screen content behind it, accessibilityViewIsModal present on a BottomSheetModal element with no effect]
applies_to: [client/screens/**/*.tsx, client/components/**/*.tsx]
created: '2026-07-02'
---

# accessibilityViewIsModal must go on the sheet's content View, not on BottomSheetModal

## Rule

Never rely on `accessibilityViewIsModal` set on a `<BottomSheetModal>` — it is a silent no-op. Set it on the sheet's **content root View** (the first real `View` rendered as the modal's children) instead.

## Why

`@gorhom/bottom-sheet`'s `BottomSheetProps` extends RN's `AccessibilityProps`, so the prop **typechecks** on the modal — but the library's render path destructures and forwards only `accessible`, `accessibilityLabel`, and `accessibilityRole` (verified in the `@gorhom/bottom-sheet@5.2.14` source; `accessibilityViewIsModal` appears nowhere in `BottomSheet.tsx`). The result: VoiceOver focus is not trapped, and users can swipe behind the open sheet — while the code *looks* compliant with the "modal screens must have accessibilityViewIsModal" rule.

Found in the PR #485 review: both new import-sheet hosts (and all four pre-existing MealPlanHomeScreen sheets) carried the no-op modal-level prop.

## Examples

```tsx
// ✗ no-op — typechecks, does nothing
<BottomSheetModal ref={sheetRef} snapPoints={SNAP_POINTS} accessibilityViewIsModal>
  <MySheetContent />
</BottomSheetModal>

// ✓ real — traps VoiceOver focus while the sheet is presented
// (inside MySheetContent)
<View style={styles.content} accessibilityViewIsModal>
  {...rows}
</View>
```

Fixing the shared content component repairs every host at once — `ImportRecipeSheetContent` (PR #485) is the precedent, `RecipeBrowserScreen.tsx`'s `<BottomSheetView accessibilityViewIsModal>` (~line 1004) the pre-existing working example.

## Exceptions

- The prop is iOS-only either way; Android TalkBack can still reach behind-content — a pattern-wide gap tracked separately (see the Android back-button todo `todos/P3-2026-07-02-bottomsheet-android-back-dismiss.md` for the sibling Android parity issue).
- Since the modal's children don't mount until `.present()`, the content-level prop has no effect while the sheet is closed — no need to gate it.

## Related Files

- `client/components/meal-plan/ImportRecipeSheet.tsx` — content-level prop with the explanatory comment
- `client/screens/meal-plan/RecipeBrowserScreen.tsx` — pre-existing `BottomSheetView` example

## See Also

- [cross-link](../runtime-errors/bottomsheetmodal-in-child-component-silently-fails-to-present-2026-07-02.md) — the other class of "BottomSheetModal accepts it but it doesn't work" trap (presentation shape)
