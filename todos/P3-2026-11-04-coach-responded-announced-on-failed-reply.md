---
title: "VoiceOver/TalkBack says 'Coach responded' when a coach reply failed or was cut off"
status: backlog
priority: low
created: 2026-11-04
updated: 2026-11-04
assignee:
labels: [deferred, client, accessibility]
github_issue:
---

# VoiceOver/TalkBack says "Coach responded" when a coach reply failed or was cut off

## Summary

`client/components/coach/CoachChat.tsx` announces "Coach responded" every time
`isStreaming` goes from true to false (the "Accessibility announcements for
streaming state" effect, ~lines 318-331). That transition also happens when the
stream errors, when the user aborts it, and since #1741 when a dead socket is
aborted quietly after resume. A screen-reader user hears "Coach responded" for a
reply that did not arrive.

## Background

Found while reviewing #1741 (2026-11-04). This is not introduced by #1741: on
`main` before it, an error or abort already flipped `isStreaming` to false and
fired the same announcement. #1741 only adds one more way to reach it.

## Acceptance Criteria

- [ ] "Coach responded" is announced only when the stream ends with a reply
      (the `onDone` success path), not on error, user abort, or a quiet
      dead-socket abort
- [ ] An error end keeps its own announcement (the error toast) and does not
      also say "Coach responded"
- [ ] A test in `client/components/coach/__tests__/` (or the existing CoachChat
      test file) asserts `AccessibilityInfo.announceForAccessibility` is called
      with "Coach responded" on success and not on error

## Implementation Notes

- Smallest fix: track why the stream ended. For example, set a ref in the
  `onDone` handler passed to `useCoachStream` (~line 263) and only announce
  "Coach responded" when that ref is set. Leave `useCoachStream` unchanged.
- Check how the quiet dead-socket abort from #1741 reaches the consumer
  (`client/hooks/useCoachStream.ts`, the resume watchdog calling
  `onDoneRef.current?.(partial)`). Decide whether a partial reply counts as
  "responded". Recommendation: announce only when the partial text is
  non-empty.
- Files: `client/components/coach/CoachChat.tsx` and its test.

## Scope Contract

- **Mechanisms to use:** a ref or flag inside `CoachChat.tsx`; the existing
  `AccessibilityInfo` call.
- **Files in scope:** `client/components/coach/CoachChat.tsx`, its test file.
- No new mechanisms, files, or abstractions beyond those listed.

## Updates

### 2026-11-04

- Filed from the #1741 review (pre-existing, low).
