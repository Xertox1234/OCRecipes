---
title: accessibilityViewIsModal must go on the sheet's content View — BottomSheetModal typechecks but never forwards it
track: knowledge
category: conventions
module: client
tags: [accessibility, gorhom-bottom-sheet, bottom-sheet, voiceover, react-native]
symptoms: [VoiceOver can swipe out of an open bottom sheet into the screen content behind it, accessibilityViewIsModal present on a BottomSheetModal element with no effect]
applies_to: [client/screens/**/*.tsx, client/components/**/*.tsx]
created: '2026-07-02'
last_updated: '2026-09-20'
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

### When the sheet has no existing single content root (2026-09-20)

Some sheet-content components return a bare `Fragment` of multiple top-level
siblings instead of a single wrapping `View` (e.g. a header + a search box +
a `BottomSheetFlatList`, each a direct child with no common ancestor inside
the component). `accessibilityViewIsModal` needs one ancestor View spanning
*everything* that should stay reachable — a `Fragment` cannot carry the prop,
and per [the later-siblings gotcha](../logic-errors/accessibilityviewismodal-later-siblings-stay-accessible-2026-08-17.md),
flagging only one sibling (e.g. just the header) does not trap the others
correctly either. Converting the Fragment to a single wrapping element is
therefore necessary, not optional — but **use a plain `View`, not
`BottomSheetView`, if any child is itself a `BottomSheet*` scrollable**
(`BottomSheetFlatList`, `BottomSheetScrollView`): `BottomSheetView` calls
`useFocusHook(handleSettingScrollable)` on mount/render
(`node_modules/@gorhom/bottom-sheet` `BottomSheetView.tsx` ~line 79), writing
`SCROLLABLE_TYPE.VIEW` into the same shared `animatedScrollableState` that a
nested `BottomSheetFlatList` writes `SCROLLABLE_TYPE.FLATLIST` into — since
child effects flush before the parent's under React's effect-order guarantee,
the wrapping `BottomSheetView`'s registration would win and clobber the
FlatList's own. A plain `View` (with `style={{ flex: 1 }}` to preserve the
prior layout, since the sheet's own DraggableView already provides an
explicit height when `enableDynamicSizing` is false) registers nothing and is
a net-neutral wrapper. Precedent: `client/components/meal-plan/QuickAddSheet.tsx`.

## Audit lesson — grep the rendered CHILD component, not the screen (2026-09-20)

When auditing which sheet sites already have this fix, grepping only the
*screen* file (`HomeScreen.tsx`, `RecipeEntryHubScreen.tsx`, etc.) for
`accessibilityViewIsModal` undercounts: several screens render a
sheet's content via an imported, shared component
(`ImportRecipeSheetContent`) whose own inner View already carries the prop —
invisible to a screen-scoped grep. A prior audit
(`todos/archive/P3-2026-09-14-bottomsheetmodal-background-trap-and-on-device-pass.md`,
its original "Has none" list) miscounted 3 sites as missing the trap for
exactly this reason. Always trace to the actual rendered content component
before concluding a site lacks the fix.

## Exceptions

- The prop is iOS-only either way; Android TalkBack can still reach behind-content — a
  pattern-wide gap that, as of 2026-09-20, **no open todo tracks** for the BottomSheetModal
  sites. Verified rather than assumed: `todos/archive/P3-2026-07-02-bottomsheet-android-back-dismiss.md`
  is about the hardware BACK BUTTON and contains zero TalkBack mentions;
  `todos/archive/P3-2026-06-22-android-overlay-talkback-focus-trap.md` and
  `todos/archive/P2-2026-09-05-confirmation-sheet-lacks-android-talkback-focus-trap.md` are both
  `status: done`, and the latter is scoped to `ConfirmationModal.tsx` and its callers. File a todo
  before citing one.
- Since the modal's children don't mount until `.present()`, the content-level prop has no effect while the sheet is closed — no need to gate it.

## Related Files

- `client/components/meal-plan/ImportRecipeSheet.tsx` — content-level prop with the explanatory comment
- `client/screens/meal-plan/RecipeBrowserScreen.tsx` — pre-existing `BottomSheetView` example
- `client/components/meal-plan/QuickAddSheet.tsx` — the Fragment-to-plain-View conversion (2026-09-20), with the sourced `useFocusHook` comment
- `client/components/meal-plan/AddItemMenuSheet.tsx`, `SimpleEntrySheet.tsx` — the existing-single-root case (2026-09-20)

## See Also

- [cross-link](../runtime-errors/bottomsheetmodal-in-child-component-silently-fails-to-present-2026-07-02.md) — the other class of "BottomSheetModal accepts it but it doesn't work" trap (presentation shape)
