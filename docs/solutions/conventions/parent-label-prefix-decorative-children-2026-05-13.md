---
title: "Parent label prefix for decorative child elements (accessibility)"
track: knowledge
category: conventions
tags: [react-native, accessibility, voiceover, talkback, labels]
module: client
applies_to: ["client/components/**/*.tsx", "client/screens/**/*.tsx"]
created: 2026-05-13
---

# Parent label prefix for decorative child elements (accessibility)

## Rule

When a component has a decorative badge or status indicator that is a visual child of an interactive parent (like a `Pressable`), prevent double-announcement by:

1. Prefixing the parent's `accessibilityLabel` with the badge status
2. Setting `accessible={false}` on the child element

This pattern applies to any card, button, or interactive component with a decorative badge (remix badge, premium lock, allergen indicator, etc.).

## Examples

```typescript
// Bad: Child badge announces separately — VoiceOver hears "Remixed recipe" twice
<Pressable
  accessibilityLabel="Pasta Carbonara by Alice"
  accessibilityRole="button"
>
  <View>
    <Image source={{ uri: imageUrl }} />
    <Text>Pasta Carbonara</Text>
    {remixedFromId && (
      <View style={styles.remixBadge}>
        <Feather name="repeat-2" size={12} />
        <Text accessibilityLabel="Remixed recipe">Remixed</Text>
      </View>
    )}
  </View>
</Pressable>
```

```typescript
// Good: Parent label includes badge status; child is invisible to a11y tree
<Pressable
  accessibilityLabel={
    remixedFromId
      ? "Remixed recipe. Pasta Carbonara by Alice"
      : "Pasta Carbonara by Alice"
  }
  accessibilityRole="button"
>
  <View>
    <Image source={{ uri: imageUrl }} />
    <Text>Pasta Carbonara</Text>
    {remixedFromId && (
      <View
        style={styles.remixBadge}
        accessible={false}  // Hide from a11y tree
      >
        <Feather name="repeat-2" size={12} />
        <Text>Remixed</Text>
      </View>
    )}
  </View>
</Pressable>
```

## Why

React Native's accessibility system (iOS VoiceOver, Android TalkBack) announce all interactive element labels in hierarchy. A child with `accessibilityLabel` inside a parent `Pressable` causes both to announce, resulting in repetition. Setting `accessible={false}` removes the child from the a11y tree while keeping it visually rendered. Prefixing the parent's label ensures the information is still available to screen reader users.

## Exceptions

**When to use:**

- Decorative badges in card/button components (remix badge, lock icon, allergen dot)
- Status indicators that are visual-only (not tappable)
- Components where the badge semantics should roll into the parent label

**When NOT to use:**

- Interactive badges or controls (if the badge itself is tappable, it needs its own label)
- Informational text that provides different meaning than the parent (e.g., an error message that contradicts the parent label)

## Related Files

- Touch target rule: badge wrapper itself should never be tappable (hit target only on parent)

## See Also

- [Accessibility props pattern](../design-patterns/accessibility-props-pattern-2026-05-13.md)
- [Decorative icons inside interactive elements](../design-patterns/accessibility-props-pattern-2026-05-13.md)
