---
title: Parent label prefix for decorative child elements (accessibility)
track: knowledge
category: conventions
module: client
tags: [react-native, accessibility, voiceover, talkback, labels]
applies_to: [client/components/**/*.tsx, client/screens/**/*.tsx]
created: '2026-05-13'
last_updated: '2026-07-03'
---

# Parent label prefix for decorative child elements (accessibility)

## Rule

When a component has a decorative badge or status indicator that is a visual child of an interactive parent (like a `Pressable`), prevent double-announcement by:

1. Prefixing the parent's `accessibilityLabel` with the badge status
2. Hiding the child from the accessibility tree — **scope the hiding to what the child contains**:
   - Icon-only child: `accessible={false}` suffices.
   - Child with an announceable descendant (a `Text` node, a labeled subview): `accessible={false}` alone does NOT silence descendants — TalkBack still reads the text. Use the full subtree treatment: `accessible={false}` + `accessibilityElementsHidden` + `importantForAccessibility="no-hide-descendants"`.

This pattern applies to any card, button, or interactive component with a decorative badge (remix badge, premium lock, allergen indicator, etc.).

**Fix at the source, not per call site.** A reusable badge component (`CuratedBadge`, `AllergenBadge`, `VerificationBadge` class) must not hardcode its own `accessibilityLabel` when its placements live inside labeled parents — make the component decorative internally so a new placement cannot re-introduce the bug, and put the status in each parent's label. When fixing one badge instance, sweep the same container and sibling badge components for the identical pattern: the 2026-07 CarouselRecipeCard remix fix initially missed the structurally identical `CuratedBadge` bug 12 lines below it (PR #499 review).

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

- `client/components/CuratedBadge.tsx` — decorative-at-the-source exemplar (full subtree treatment; renders a visible `Text` child)
- `client/components/home/CarouselRecipeCard.tsx` — parent label composing remix + curated status prefixes
- Touch target rule: badge wrapper itself should never be tappable (hit target only on parent)

## See Also

- [Accessibility props pattern](../design-patterns/accessibility-props-pattern-2026-05-13.md)
- [Decorative badge double-announcement on interactive cards](../logic-errors/decorative-badge-double-announcement-2026-05-13.md) — the bug shape this rule prevents
- [jsdom RN render tests cannot assert a11y-tree hiding](jsdom-rn-render-tests-cannot-assert-a11y-tree-hiding-2026-07-03.md) — how to test compliance honestly
