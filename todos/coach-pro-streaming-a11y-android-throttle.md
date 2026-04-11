---
title: "Coach Pro: Throttle Android accessibilityLiveRegion during streaming"
status: backlog
priority: low
created: 2026-04-10
updated: 2026-04-10
assignee:
labels: [coach-pro, client, accessibility, android]
---

# Coach Pro: Throttle Android accessibilityLiveRegion during streaming

## Summary

The `accessibilityLiveRegion="polite"` wrapper on the streaming content area in CoachChat fires on every content update during streaming. TalkBack queues announcements for each chunk, which may overwhelm screen reader users with partial text fragments.

## Background

Discovered during code review of the Coach Pro streaming accessibility implementation. On iOS, announcements are explicit (`announceForAccessibility` on start/finish only), but on Android, `accessibilityLiveRegion` triggers automatically on any content change within the View.

## Acceptance Criteria

- [ ] Android TalkBack only announces streaming start and completion, not intermediate chunks
- [ ] Streaming content is still accessible to TalkBack when reading manually
- [ ] iOS behavior remains unchanged

## Implementation Notes

- `client/components/coach/CoachChat.tsx` — the `accessibilityLiveRegion="polite"` View wrapper
- Option A: Only set `accessibilityLiveRegion` on the typing indicator and final response, not the streaming content
- Option B: Dynamically toggle `accessibilityLiveRegion` — set to `"none"` during active streaming, switch to `"polite"` when streaming completes
- Option C: Use explicit `AccessibilityInfo.announceForAccessibility()` on Android too (matching iOS approach) and remove `accessibilityLiveRegion` from the streaming wrapper
- Test with TalkBack on Android emulator or physical device
