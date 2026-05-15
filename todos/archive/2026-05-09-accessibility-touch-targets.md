---
title: "Fix touch target sizes and decorative icon accessible={false} across new components"
status: done
priority: medium
created: 2026-05-09
updated: 2026-05-09
assignee:
labels: [deferred, accessibility, audit-2026-05-09]
---

# Fix touch target sizes and decorative icon accessible={false} across new components

## Summary

Multiple new components have touch targets below the 44pt WCAG minimum, and decorative icons inside labeled Pressables are missing `accessible={false}` causing double-focus in VoiceOver.

## Background

Identified in the 2026-05-09 full audit (M15, M16) by the accessibility-specialist agent.

## Acceptance Criteria

### Touch targets (add `hitSlop` or increase padding to reach 44pt):

- [ ] `CommitmentCard.tsx:116,118` — Accept and Dismiss Pressables (~28pt → add `hitSlop={{ top: 8, bottom: 8 }}`)
- [ ] `QuickReplies.tsx:51` — chip Pressables (~30pt → add `hitSlop={{ top: 7, bottom: 7 }}`)
- [ ] `NotebookScreen.tsx:266,277` — New button and filter chips (~30pt → add hitSlop)
- [ ] `NotebookEntryScreen.tsx:355` — type chips (~30pt → add hitSlop)
- [ ] `QuickLogDrawer.tsx:307–319` — camera button (36×36pt → add `hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}`)

### Decorative icons (add `accessible={false}` to icon children inside labeled Pressables):

- [ ] `NotebookScreen.tsx:142,151,188` — archive, trash-2, x icons
- [ ] `AllConversationsScreen.tsx:136–184` — bookmark, trash-2, x, search icons
- [ ] `QuickLogDrawer.tsx:124,319` — x and camera icons
- [ ] `CoachMicButton.tsx:88–92` — microphone icon

## Implementation Notes

`hitSlop` is the preferred approach over increasing visual padding (avoids layout changes). The `accessible={false}` prop on Icon components prevents VoiceOver from creating a separate focus stop for the icon when the parent Pressable already has `accessibilityLabel`.
