---
title: enableDynamicSizing for minimal-content bottom sheets
track: knowledge
category: design-patterns
module: client
tags: [react-native, bottom-sheet, sizing, dynamic-sizing]
applies_to: [client/hooks/**/*.ts, client/components/**/*.tsx]
created: '2026-05-13'
---

# enableDynamicSizing for minimal-content bottom sheets

## When this applies

When a bottom sheet contains minimal content (confirmation dialogs, single-action prompts, ~200px of content), use `enableDynamicSizing={true}` with `maxDynamicContentSize` instead of fixed `snapPoints`. Fixed percentage snap points (e.g., `["45%"]`) leave excessive empty space below short content.

## Examples

```typescript
// GOOD — sheet sizes to content, capped at 350px
<BottomSheetModal
  ref={sheetRef}
  enableDynamicSizing={true}
  maxDynamicContentSize={350}
>
  <BottomSheetView>  {/* Required wrapper for dynamic sizing */}
    <ThemedText>Are you sure?</ThemedText>
    <Pressable onPress={handleConfirm}>
      <ThemedText>Confirm</ThemedText>
    </Pressable>
  </BottomSheetView>
</BottomSheetModal>

// BAD — 45% of screen for 200px of content
<BottomSheetModal
  ref={sheetRef}
  snapPoints={["45%"]}
  enableDynamicSizing={false}
>
  <View>
    <ThemedText>Are you sure?</ThemedText>
    <Pressable onPress={handleConfirm}>
      <ThemedText>Confirm</ThemedText>
    </Pressable>
  </View>
</BottomSheetModal>
```

## Why

**Key elements:**

1. **`enableDynamicSizing={true}`** — sheet measures content and sizes accordingly
2. **`maxDynamicContentSize={350}`** — prevents the sheet from growing too tall on content-heavy renders
3. **`<BottomSheetView>` wrapper** — required for dynamic sizing (plain `<View>` won't measure correctly)
4. **Omit `snapPoints`** — dynamic sizing and snap points are mutually exclusive

## Exceptions

When to use: Confirmation dialogs, single-action prompts, short forms with 1-3 fields.

When NOT to use: Multi-section sheets with scrollable content — use fixed `snapPoints` with `BottomSheetScrollView` instead.

## Related Files

- `client/hooks/useConfirmationModal.ts` — dynamically-sized confirmation sheet
- Existing fixed-snap-point sheets: `RecipeCreateScreen`, `GroceryListScreen`

## See Also

- [beforeRemove navigation guard with bottom sheet](beforeremove-navigation-guard-bottom-sheet-2026-05-13.md)
- [Inline quick-add bottom sheet](inline-quick-add-bottom-sheet-2026-05-13.md)
