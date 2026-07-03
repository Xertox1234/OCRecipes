---
title: Switch row wrapped in Pressable for full-row accessibility
track: knowledge
category: design-patterns
module: client
tags: [react-native, accessibility, switch, settings, voiceover]
applies_to: [client/components/**/*.tsx, client/screens/**/*.tsx]
created: '2026-05-13'
---

# Switch row wrapped in Pressable for full-row accessibility

## When this applies

When a settings row contains a `Switch` and tapping anywhere on the row should toggle it, wrap the row in `Pressable` and hide the `Switch` from assistive technology entirely. This gives screen readers one coherent element (the row) with a correct `checked` state and full label, rather than two separate focusable elements (the row label + the switch).

## Examples

```typescript
<Pressable
  style={styles.row}
  onPress={() => handleToggle(item.key, currentValue)}
  accessible={true}
  accessibilityRole="switch"
  accessibilityLabel={item.label}
  accessibilityState={{
    checked: isEnabled,
    disabled: isLoading || mutation.isPending,
  }}
  disabled={isLoading || mutation.isPending}
>
  <View style={styles.labelContainer} accessible={false}>
    <ThemedText>{item.label}</ThemedText>
  </View>
  <Switch
    value={isEnabled}
    // No onValueChange — Pressable owns the interaction
    accessible={false}
    importantForAccessibility="no"
    pointerEvents="none"
  />
</Pressable>
```

## Why

`accessible={false}` removes the Switch from the VoiceOver/TalkBack focus order; `importantForAccessibility="no"` suppresses it on Android's accessibility tree; `pointerEvents="none"` prevents it from intercepting tap events so the `Pressable` receives them.

## Exceptions

When to use: any list row where a `Switch` is a secondary visual indicator but the primary interaction is the full row tap.

When NOT to use: Standalone `Switch` elements not embedded in a larger tappable row — those should keep their native accessibility intact.

## Related Files

- `client/screens/CoachRemindersScreen.tsx`
