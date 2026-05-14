---
title: "Native text overlay on react-native-svg requires explicit z-ordering"
track: knowledge
category: design-patterns
tags: [react-native, svg, layout, z-index, overflow, fonts]
module: client
applies_to: ["client/components/**/*.tsx"]
created: 2026-05-13
---

# Native text overlay on react-native-svg requires explicit z-ordering

## When this applies

When overlaying a native `View` with `Text` on top of an `<Svg>` element (e.g., center text inside a circular progress ring), the SVG's native view can obscure the text even though the `View` appears later in the component tree. This is because `react-native-svg` creates a native drawing surface that may not respect React Native's default sibling z-ordering.

## Examples

```typescript
// BAD: Text may be hidden behind the SVG native layer
<View style={{ width: 280, height: 280 }}>
  <Svg width={280} height={280}>
    <Circle ... />
  </Svg>
  <View style={StyleSheet.absoluteFillObject}>
    <Text style={{ fontSize: 36 }}>09:55</Text>
  </View>
</View>

// GOOD: Force text above SVG with zIndex + prevent container clipping
<View style={{ width: 280, height: 280, overflow: "visible" }}>
  <Svg width={280} height={280}>
    <Circle ... />
  </Svg>
  <View style={[StyleSheet.absoluteFillObject, { zIndex: 1 }]}>
    <Text style={{ fontSize: 36, lineHeight: 46 }}>09:55</Text>
  </View>
</View>
```

## Why

Three things to get right:

1. **`zIndex: 1`** on the text overlay — forces it above the SVG native layer
2. **`overflow: "visible"`** on the container — prevents parent clipping from cutting off text
3. **Explicit `lineHeight`** for large custom fonts — Poppins and similar fonts have ascenders that extend beyond the default line height at large sizes, causing clipping

## Related Files

- `client/components/FastingTimer.tsx` — time display overlay on SVG circular progress ring
- Discovered during PR #25 physical device testing

## See Also

- [SVG elements are invisible to the accessibility tree](../conventions/svg-elements-invisible-to-accessibility-tree-2026-05-13.md)
