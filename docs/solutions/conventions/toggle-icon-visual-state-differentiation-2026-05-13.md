---
title: "Toggle Icon Buttons Must Use Multiple Visual State Signals"
track: knowledge
category: conventions
tags: [accessibility, design-system, icons, toggle, a11y]
module: client
applies_to: ["client/components/**/*.tsx", "client/screens/**/*.tsx"]
created: 2026-02-12
---

# Toggle Icon Buttons Must Use Multiple Visual State Signals

## Rule

A toggle action surfaced as an icon button must change **at least two** of: icon name, color, label, fill style. A single change (e.g., opacity alone) is insufficient for accessibility and at-a-glance scanning. The `accessibilityHint` must also differ between states so screen-reader users get the same distinction sighted users get.

## Smell patterns

- Same icon name and same color used for both "on" and "off" states of a toggle.
- Only opacity or only a subtle tint changes between states.
- `accessibilityHint` is the same string in both states ("Toggle favourite").
- The state is conveyed entirely by a small badge dot or pill that's hard to spot at a glance.

## Why

The initial implementation of the favourite action button used the same `heart` icon with the same color for both favourited and unfavourited states. Users could not tell at a glance whether an item was already favourited. The same defect on accessibility: a screen reader reading the same hint for both states gives the user no way to know which state the button is in.

Sighted users scan a list of icons in milliseconds; the differentiator needs to be high-contrast (color change) or structural (icon shape change). Opacity changes are commonly used to indicate "disabled," so reusing opacity for "off-state" overloads the visual vocabulary.

## Examples

```typescript
// ❌ Single-channel differentiation (color only, easy to miss)
<ActionButton
  icon="heart"
  color={isFavourited ? theme.error : theme.error}
  accessibilityHint="Toggle favourite"
/>

// ❌ Opacity-only (looks like a "disabled" button)
<ActionButton
  icon="heart"
  style={{ opacity: isFavourited ? 1 : 0.4 }}
  accessibilityHint="Toggle favourite"
/>

// ✅ Two channels: color + label, plus distinct hint
<ActionButton
  icon="heart"
  label={isFavourited ? "Saved" : "Favourite"}
  color={isFavourited ? theme.error : theme.textSecondary}
  accessibilityHint={
    isFavourited ? "Remove from favourites" : "Add to favourites"
  }
/>

// ✅ Icon swap + color (also acceptable)
<ActionButton
  icon={isFavourited ? "heart-fill" : "heart"}
  color={isFavourited ? theme.error : theme.textSecondary}
  accessibilityHint={
    isFavourited ? "Remove from favourites" : "Add to favourites"
  }
/>
```

## Exceptions

- A pure status indicator (not a button) can rely on a single signal if it's accompanied by adjacent text.
- A primary CTA with no toggle semantics doesn't need this — the rule is specifically for stateful toggles.

## Related Files

- `client/components/HistoryItemActions.tsx` — favourite button uses icon + label + color + hint

## See Also

- [../logic-errors/toggle-favourite-race-condition-2026-05-13.md](../logic-errors/toggle-favourite-race-condition-2026-05-13.md) — Server-side companion of the toggle UI: the mutation behind this button must be transactional.
