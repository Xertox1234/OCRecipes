---
title: "Call announceAllergenWarning for iOS VoiceOver"
status: backlog
priority: medium
created: 2026-04-02
updated: 2026-04-02
assignee:
labels: [accessibility, recipe-chat]
---

# Call announceAllergenWarning for iOS VoiceOver

## Summary

The `announceAllergenWarning()` helper in `RecipeCard.tsx` is exported but never called. iOS VoiceOver users receive no announcement when an allergen warning appears on a recipe card.

## Background

`RecipeCard.tsx` has `accessibilityLiveRegion="polite"` on the allergen warning banner, which works on Android. The `announceAllergenWarning()` function exists to cover iOS via `AccessibilityInfo.announceForAccessibility()`, but it's dead code — never imported or called from `RecipeChatScreen.tsx` or anywhere else.

Per project pattern: "accessibilityLiveRegion is Android-only — pair with AccessibilityInfo.announceForAccessibility() for iOS"

Found during code review of PR #33.

## Acceptance Criteria

- [ ] `announceAllergenWarning` is called when a recipe card with an allergen warning first appears
- [ ] iOS VoiceOver announces the allergen warning text
- [ ] Android behavior unchanged (already works via `accessibilityLiveRegion`)

## Implementation Notes

In `RecipeChatScreen.tsx`, when the streaming recipe arrives with an `allergenWarning`:

```typescript
import { announceAllergenWarning } from "@/components/recipe-chat/RecipeCard";

// In the streaming effect or renderMessage, when allergenWarning is set:
if (allergenWarning) {
  announceAllergenWarning(allergenWarning);
}
```

Alternatively, call it inside `RecipeCard` itself using a `useEffect` on the `allergenWarning` prop.

## Dependencies

- None

## Updates

### 2026-04-02

- Created from PR #33 code review finding (CLAUDE.md 1, Medium)
