---
title: "Touch target size pattern (44x44 minimum) with hitSlop"
track: knowledge
category: design-patterns
tags: [react-native, accessibility, touch-target, hitslop, wcag]
module: client
applies_to: ["client/components/**/*.tsx", "client/screens/**/*.tsx"]
created: 2026-05-13
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

## Related Files

- `docs/rules/react-native.md` — touch-target rule (binding one-liner)

## See Also

- [Accessibility props pattern](accessibility-props-pattern-2026-05-13.md)
