---
title: "Drag handle for gesture-dismissible modals"
track: knowledge
category: design-patterns
tags: [react-native, modal, gesture, accessibility, drag-handle]
module: client
applies_to: ["client/screens/**/*.tsx", "client/components/**/*.tsx"]
created: 2026-05-13
---

# Drag handle for gesture-dismissible modals

## When this applies

When a root-level modal uses `gestureEnabled` + `fullScreenGestureEnabled`, replace interactive close buttons with a visual-only drag handle pill. The navigator handles dismissal — the handle is purely a visual affordance.

## Examples

```typescript
// Navigator registration
<Stack.Screen
  name="FeaturedRecipeDetail"
  options={{
    presentation: "transparentModal",
    animation: "slide_from_bottom",
    gestureEnabled: true,
    fullScreenGestureEnabled: true, // iOS swipe-right from edge
  }}
/>

// Screen — visual-only drag handle
<View style={styles.handleContainer} pointerEvents="none">
  <View style={[styles.handle, { backgroundColor: withOpacity(theme.text, 0.3) }]} />
</View>

// Styles
handleContainer: { position: "absolute", left: 0, right: 0, zIndex: 10, alignItems: "center" },
handle: { width: 36, height: 5, borderRadius: 2.5 },
```

## Why

**Key principles:**

- **`pointerEvents="none"`** on the handle — it is visual-only, not interactive.
- **`fullScreenGestureEnabled`** is iOS-only. Android users dismiss via system back button or swipe-down gesture (both work with `gestureEnabled: true`).
- **ScrollView interaction**: Native stack modal swipe-down only triggers when ScrollView is scrolled to top — no extra gesture conflict handling needed.
- **`accessibilityViewIsModal`** on the root container — VoiceOver users need to know this is a modal.

## Related Files

- `RecipeDetailContent` shared by `RecipeDetailScreen` (MealPlan stack) and `FeaturedRecipeDetailScreen` (root modal)

## See Also

- [Full-screen detail with transparentModal](full-screen-detail-transparent-modal-2026-05-13.md)
- [Unified modal with type discriminator](unified-modal-with-type-discriminator-2026-05-13.md)
- [Modal focus trapping](modal-focus-trapping-2026-05-13.md)
