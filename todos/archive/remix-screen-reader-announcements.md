---
title: "Add screen reader announcements for streaming remix recipe cards"
status: backlog
priority: medium
created: 2026-04-08
updated: 2026-04-08
assignee:
labels: [remix, accessibility]
---

# Add screen reader announcements for streaming remix recipe cards

## Summary

When a remixed recipe card appears via SSE streaming, screen reader users receive no announcement. Need `AccessibilityInfo.announceForAccessibility()` (iOS) and `accessibilityLiveRegion` (Android).

## Background

The Recipe Remix feature streams recipe cards identically to recipe chat. Neither the existing recipe chat nor the remix flow announces the recipe card appearance to screen readers. This is a broader accessibility gap in the chat streaming system, not specific to remix.

## Acceptance Criteria

- [ ] When a recipe card appears in the chat stream (recipe or remix), iOS announces "Recipe ready: {title}"
- [ ] Android uses `accessibilityLiveRegion="polite"` on the RecipeCard container
- [ ] Announcement fires only once per card (not on re-renders)
- [ ] Works in both recipe chat and remix chat modes

## Implementation Notes

- `client/components/recipe-chat/RecipeCard.tsx`: Add `useEffect` that fires `AccessibilityInfo.announceForAccessibility()` on mount
- Use `Platform.OS === "ios"` guard for `announceForAccessibility` (Android uses live regions)
- Add `accessibilityLiveRegion="polite"` to the card's outer `View` (Android-only per MEMORY.md)
- Existing pattern: see `@/lib/volume-scale` for platform-conditional behavior

## Dependencies

- Recipe Remix feature must be merged (PR #35)

## Updates

### 2026-04-08

- Created as deferred item from Recipe Remix implementation
