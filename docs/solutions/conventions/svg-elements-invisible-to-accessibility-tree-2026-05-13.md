---
title: SVG elements are invisible to the accessibility tree — wrap with summary label
track: knowledge
category: conventions
module: client
tags: [react-native, accessibility, svg, wrapping-view]
applies_to: [client/components/**/*.tsx]
created: '2026-05-13'
---

# SVG elements are invisible to the accessibility tree — wrap with summary label

## Rule

`react-native-svg` inner elements (`<G>`, `<Line>`, `<Circle>`, `<Text>`) silently ignore `accessible`, `accessibilityLabel`, and `accessibilityRole` props. Screen readers cannot focus on individual SVG elements — the entire SVG renders as a single drawing surface. Never put accessibility props on SVG child elements. Always provide an accessible summary on the parent `View` that conveys the same information visually encoded in the SVG.

## Examples

```typescript
// BAD: These props are silently ignored
<G accessible accessibilityLabel="12 hour milestone, reached">
  <Line ... />
  <SvgText>12h</SvgText>
</G>

// GOOD: Provide a summary label on the wrapping View
<View
  accessibilityLabel={`Timer: ${timeDisplay}. Milestones: 2 of 4 reached`}
  accessibilityRole="timer"
>
  <Svg width={size} height={size}>
    {/* SVG elements are purely visual */}
  </Svg>
</View>
```

## Related Files

- `client/components/FastingTimer.tsx` — milestone markers with summary label on wrapping View
- Discovered during PR #25 accessibility review

## See Also

- [Native text overlay on react-native-svg requires explicit z-ordering](../design-patterns/native-text-overlay-svg-z-ordering-2026-05-13.md)
