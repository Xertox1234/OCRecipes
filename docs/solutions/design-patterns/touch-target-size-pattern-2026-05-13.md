---
title: Touch target size pattern (44x44 minimum) with hitSlop
track: knowledge
category: design-patterns
module: client
tags: [react-native, accessibility, touch-target, hitslop, wcag]
applies_to: [client/components/**/*.tsx, client/screens/**/*.tsx]
created: '2026-05-13'
last_updated: '2026-09-25'
---

# Touch target size pattern (44x44 minimum) with hitSlop

## When this applies

Ensure interactive elements meet the minimum touch target size of 44x44 points (WCAG 2.1 Level AA requirement). Visual icons can stay small, but the tappable area must reach 44pt — use `hitSlop` to extend the touch region for sub-44pt visual elements.

## Examples

```typescript
// Good: Element meets minimum size naturally
<Pressable
  style={{ width: 48, height: 48, justifyContent: "center", alignItems: "center" }}
  onPress={handlePress}
>
  <Feather name="settings" size={24} />
</Pressable>

// Good: Small visual element with expanded touch area using hitSlop
<Pressable
  onPress={handlePress}
  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
  accessibilityLabel="Show password"
>
  <Feather name="eye" size={20} />
</Pressable>
```

### Calculating hitSlop

If your touchable is 24pt, add hitSlop of 10pt on each side to reach 44pt total: `(24 + 10 + 10) = 44pt`.

## Why

Smaller targets cause mis-taps, particularly for users with motor impairments, low-vision users who hold the device closer, or anyone using a phone one-handed. WCAG 2.1 enshrines 44x44 as the AA threshold.

## Exceptions

When to use `hitSlop`:

- Icon buttons smaller than 44pt
- Inline interactive elements (password toggle inside input)
- Dense UIs where visual spacing is constrained

## Common Pitfall: hitSlop clipped by parent bounds

React Native clips `hitSlop` to the **parent view's bounds**. If the parent's own frame is exactly button-edge-to-button-edge (no padding, e.g., a `flexDirection: row` container with only a `gap` between children and no padding), the `hitSlop` has zero room to expand into and gets clipped to nothing on every axis touching that parent edge.

**Concrete case:** In `LabelAnalysisScreen`, a `servingButton` (36×36) had `hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}` added (36+4+4=44 on paper). It sat inside `styles.servingControls`, a `flexDirection: row, alignItems: center, gap: Spacing.md` container with **no padding**. Because the row's own frame was exactly the buttons' combined bounds, the hitSlop was clipped and the effective touch target stayed at 36pt despite the mathematically correct prop.

**Fix:** Add padding to the parent matching the needed hitSlop amount:

```typescript
servingControls: {
  flexDirection: 'row',
  alignItems: 'center',
  gap: Spacing.md,
  padding: Spacing.xs, // e.g., 4pt – exactly matches hitSlop={4}
}
```

This gives the parent real slack for the hitSlop to expand into.

**General rule:** Before adding `hitSlop` to a control, check whether its immediate parent has padding or room on every axis the hitSlop needs. If not, add matching padding to the parent. When the parent is a tight row shared with an adjacent touchable target and even padding risks overlap, prefer the **explicit min 44 box** technique (set `minWidth: 44, minHeight: 44` on the control itself) which has no such clipping risk.

## Related Files

- `docs/rules/react-native.md` — touch-target rule (binding one-liner)

## See Also

- [Accessibility props pattern](accessibility-props-pattern-2026-05-13.md)