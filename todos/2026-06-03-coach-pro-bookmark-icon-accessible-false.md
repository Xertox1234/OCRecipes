---
title: "Mark pinned bookmark icon in CoachProScreen thread chips accessible={false}"
status: backlog
priority: low
created: 2026-06-03
updated: 2026-06-03
assignee:
labels: [deferred, accessibility]
github_issue:
---

# Mark pinned bookmark icon in CoachProScreen thread chips accessible={false}

## Summary

`CoachProScreen` pinned bookmark icon inside each `Pressable` thread chip lacks `accessible={false}`. VoiceOver focuses it as a separate element when the chip is pinned, adding an extra unwanted focus stop per pinned conversation.

## Background

Deferred from 2026-06-03 full audit (M9). File: `client/screens/CoachProScreen.tsx:287-292`. Decorative icons inside labeled Pressables must have `accessible={false}` per project accessibility rules.

## Acceptance Criteria

- [ ] Pinned bookmark icon `Feather` element has `accessible={false}`
- [ ] VoiceOver navigates thread chips in one focus stop (not two when pinned)

## Implementation Notes

Add `accessible={false}` prop to the bookmark `Feather` icon at line 287-292. Confirm the parent `Pressable` has an `accessibilityLabel` that describes the pinned state.

## Dependencies

- None

## Risks

- Minimal — single prop addition

## Updates

### 2026-06-03

- Initial creation (deferred from full audit M9)
