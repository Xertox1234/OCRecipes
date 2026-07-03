---
title: Full-screen detail with transparentModal presentation
track: knowledge
category: design-patterns
module: client
tags: [react-native, navigation, modal, ios, presentation]
applies_to: [client/navigation/**/*.tsx, client/screens/**/*.tsx]
created: '2026-05-13'
---

# Full-screen detail with transparentModal presentation

## When this applies

Use `presentation: "transparentModal"` with `slide_from_bottom` animation for full-screen detail views. The screen component fills the entire screen with its own background, close button, and scrollable content. The hero image extends to the very top with no native chrome.

## Examples

### Key learnings from iOS modal presentations

| Presentation                | Background visible            | Native chrome        | Verdict          |
| --------------------------- | ----------------------------- | -------------------- | ---------------- |
| `modal` / `formSheet`       | Yes                           | Grabber bar, detents | Not customizable |
| `containedTransparentModal` | Yes                           | Grabber bar          | Not customizable |
| `fullScreenModal`           | No (detaches previous screen) | None                 | Black background |
| `transparentModal`          | Yes                           | None                 | Use this one     |

### Navigator config

```typescript
// RootStackNavigator.tsx
<Stack.Screen
  name="RecipeDetail"
  component={RecipeDetailScreen}
  options={{
    headerShown: false,
    presentation: "transparentModal",
    animation: "slide_from_bottom",
  }}
/>
```

### Screen component

```typescript
// RecipeDetailScreen.tsx
export default function RecipeDetailScreen() {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const navigation = useNavigation();
  const dismiss = useCallback(() => navigation.goBack(), [navigation]);

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
      {/* Close button — floats over hero image */}
      <View style={[styles.closeHeader, { top: insets.top + Spacing.xs }]}>
        <Pressable
          onPress={dismiss}
          hitSlop={8}
          style={styles.closeButton}
          accessibilityLabel="Close"
          accessibilityRole="button"
        >
          <Feather name="chevron-down" size={20} color="#fff" />
        </Pressable>
      </View>

      <ScrollView
        contentInsetAdjustmentBehavior="never"
        automaticallyAdjustContentInsets={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + Spacing.xl }}
      >
        <Image source={{ uri: imageUri }} style={styles.heroImage} />
        {/* Content below image */}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  closeHeader: {
    position: "absolute",
    right: Spacing.md,
    zIndex: 10,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(0,0,0,0.4)", // hardcoded
    alignItems: "center",
    justifyContent: "center",
  },
  heroImage: {
    width: "100%",
    height: 250,
  },
});
```

**Critical ScrollView props:** On iOS, ScrollView inside a modal automatically adds content insets for the status bar. Set `contentInsetAdjustmentBehavior="never"` and `automaticallyAdjustContentInsets={false}` to prevent a gap above the hero image.

## Why

`transparentModal` is the only native-stack presentation that both keeps the previous screen visible (no black/grey background flash) and adds no native chrome (no grabber bars or forced corner radius). The tradeoff is you must handle your own close button and cannot use native swipe-to-dismiss.

## Exceptions

When to use: Detail views, recipe cards, or any screen that slides up over the current content as a full-screen overlay.

When NOT to use: Standard modals that benefit from native iOS sheet gestures (drag-to-dismiss detents). Use `presentation: "modal"` or `formSheet` for those. Camera screens — see `fullScreenModal` exception.

Cross-navigator reuse: When the same content appears from multiple entry points across different navigators, use a single root-level modal with a type discriminator param.

## See Also

- [fullScreenModal exception for camera](../conventions/fullscreen-modal-exception-for-camera-2026-05-13.md)
- [Unified modal with type discriminator](unified-modal-with-type-discriminator-2026-05-13.md)
- [Drag handle for gesture-dismissible modals](drag-handle-gesture-dismissible-modals-2026-05-13.md)
