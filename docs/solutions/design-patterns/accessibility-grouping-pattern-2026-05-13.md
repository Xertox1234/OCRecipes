---
title: "Accessibility grouping pattern with accessible={true}"
track: knowledge
category: design-patterns
tags: [react-native, accessibility, voiceover, grouping]
module: client
applies_to: ["client/components/**/*.tsx", "client/screens/**/*.tsx"]
created: 2026-05-13
---

# Accessibility grouping pattern with accessible={true}

## When this applies

Group related elements so screen readers announce them together as a single unit, rather than forcing element-by-element navigation through every text node in a card.

## Examples

```typescript
// Good: Card announced as single unit
<View
  accessible={true}
  accessibilityLabel={`${productName}, ${brandName}, ${calories} calories. Scanned ${relativeTime}`}
>
  <Text>{productName}</Text>
  <Text>{brandName}</Text>
  <Text>{calories} cal</Text>
  <Text>{relativeTime}</Text>
</View>
```

## Why

Element-by-element navigation through every text node in a card is tedious and loses the relationship between the fields. A single grouped announcement preserves the semantic relationship (this name belongs to this brand with these calories).

## Exceptions

When to use `accessible={true}`:

- Cards or list items with multiple text elements
- Complex components that should be announced as one unit
- When navigating element-by-element would be tedious

When NOT to use: when child elements are independently interactive (buttons, links within the group).

## See Also

- [Accessibility props pattern](accessibility-props-pattern-2026-05-13.md)
- [Parent label prefix for decorative children](../conventions/parent-label-prefix-decorative-children-2026-05-13.md)
