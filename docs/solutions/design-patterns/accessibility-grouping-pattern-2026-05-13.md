---
title: 'Accessibility grouping pattern with accessible={true}'
track: knowledge
category: design-patterns
module: client
tags: [react-native, accessibility, voiceover, grouping, image]
applies_to: [client/components/**/*.tsx, client/screens/**/*.tsx]
created: '2026-05-13'
last_updated: '2026-07-30'
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

```typescript
// Good: an image + its visible caption. The label goes on the GROUP, never
// on the <Image> — see "Labelling an image" below.
<View accessible accessibilityLabel="Nutrition label you photographed">
  <FallbackImage source={{ uri: nutritionImageUri }} resizeMode="contain" />
  <ThemedText type="caption">Nutrition label</ThemedText>
</View>
```

## Labelling an image (added 2026-07-30, PR #742)

**An `accessibilityLabel` on a React Native `<Image>` is the wrong place for
it, and both possible outcomes are bad.** RN gates on
`accessible={props.alt !== undefined ? true : props.accessible}` — *identically*
in `Image.ios.js` and `Image.android.js` — so a bare `accessibilityLabel`
does not make the image an accessibility element on either platform, and may
simply never be announced. If a platform heuristic surfaces it anyway, it now
**double-announces** against the visible caption beside it ("Nutrition label
you photographed", then "Nutrition label"), which
`docs/rules/accessibility.md` prohibits.

Wrapping in one `accessible` group avoids the question entirely: image and
caption collapse to a single node carrying a single label.

Two conditions must hold, and they are the same ones this pattern always
requires — they are just easy to miss when the group is "only an image":

- **No interactive child.** `accessible={true}` on a wrapper containing a
  `Pressable` makes the button unreachable.
- **The group label must contain the caption's words.** A collapsed subtree
  announces *only* the group's label, so any nested text not reflected in it
  is silently dropped. Pin this in tests by comparing both off the DOM, not by
  matching two hand-written strings.

## Why

Element-by-element navigation through every text node in a card is tedious and loses the relationship between the fields. A single grouped announcement preserves the semantic relationship (this name belongs to this brand with these calories).

For an image plus caption the motivation is different but the mechanism is the
same: the group is the only reliable place to put the label at all.

## Exceptions

When to use `accessible={true}`:

- Cards or list items with multiple text elements
- Complex components that should be announced as one unit
- When navigating element-by-element would be tedious

When NOT to use: when child elements are independently interactive (buttons, links within the group).

## See Also

- [Accessibility props pattern](accessibility-props-pattern-2026-05-13.md)
- [Parent label prefix for decorative children](../conventions/parent-label-prefix-decorative-children-2026-05-13.md)
- [Assert the rendered source, not the labelled node, when a fallback shares the label](../conventions/assert-source-not-label-when-fallback-shares-it-2026-07-30.md) — how to test a group like this, and why jsdom cannot see `accessible` in either direction
