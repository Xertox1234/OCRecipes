---
title: "Decorative Badge Double-Announcement on Interactive Cards"
track: bug
category: logic-errors
tags: [accessibility, voiceover, talkback, decorative-elements, screen-reader]
module: client
applies_to:
  ["client/components/HomeRecipeCard.tsx", "client/components/**/*Card.tsx"]
symptoms:
  - "VoiceOver/TalkBack reads a status label twice when tapping a card"
  - "Decorative badge inside an interactive parent has its own `accessibilityLabel`"
  - "Single user action produces two consecutive screen reader announcements"
created: 2026-04-26
severity: medium
---

# Decorative Badge Double-Announcement on Interactive Cards

## Problem

`HomeRecipeCard` rendered a remix badge (`View` with icon + text) inside an interactive `Pressable` parent. Both the badge and the parent had their own `accessibilityLabel`. iOS VoiceOver and Android TalkBack announced both labels back-to-back when the card was focused: "Remixed recipe" then "Pasta Carbonara by Alice."

## Symptoms

- Screen reader users hear the same status word twice per card
- Both labels are individually correct; the duplication is a tree-traversal side effect
- All decorative badges (lock, allergen dot, premium status) have the same shape and the same bug

## Root Cause

VoiceOver and TalkBack traverse the view hierarchy and announce every `accessibilityLabel` they encounter. React Native does not automatically suppress child labels when the parent has its own label. The badge is decorative — visually redundant with the card title — so giving it an a11y label adds noise instead of information.

## Solution

Two-part fix:

1. Prefix the parent's `accessibilityLabel` with the badge status when it is present.
2. Set `accessible={false}` on the badge `View` to remove it from the a11y tree while keeping it visually rendered.

```typescript
<Pressable
  accessibilityLabel={
    remixedFromId
      ? "Remixed recipe. Pasta Carbonara by Alice"
      : "Pasta Carbonara by Alice"
  }
>
  {remixedFromId && (
    <View accessible={false}>{/* hidden from a11y tree */}
      <Feather name="repeat-2" size={12} />
      <Text>Remixed</Text>
    </View>
  )}
</Pressable>
```

Result: single announcement per interaction; remix status is still conveyed via the parent label.

## Prevention

- Decorative visual elements inside an interactive parent must NEVER have their own `accessibilityLabel`.
- Always prefix the parent label with status text when a badge conveys semantically important state.
- Use `accessible={false}` to hide a decorative View from the a11y tree without affecting layout.
- This applies to every card, button, or interactive component with badges — lock icons, allergen dots, premium tier indicators, remix marks.

## Related Files

- `client/components/HomeRecipeCard.tsx:56,106–121` — fixed implementation
- WCAG: [1.3.1 Info and Relationships (Level A)](https://www.w3.org/WAI/WCAG21/Understanding/info-and-relationships.html)

## See Also

- [Parent label prefix for decorative children](../conventions/parent-label-prefix-decorative-children-2026-05-13.md)
- [Accessibility grouping pattern](../design-patterns/accessibility-grouping-pattern-2026-05-13.md)
