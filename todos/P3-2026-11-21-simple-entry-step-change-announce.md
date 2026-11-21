---
title: "Announce Simple Entry's estimate → review step change"
status: backlog
priority: low
created: 2026-11-21
updated: 2026-11-21
assignee:
labels: [deferred, accessibility, client]
github_issue:
---

# Announce Simple Entry's estimate → review step change

## Summary

Accessibility audit 2026-11-21 finding, deferred at triage by the owner (or a part of a fixed finding that needs a design call). Source: `docs/audits/2026-11-21-accessibility.md` (local manifest).

## Background

`client/components/meal-plan/SimpleEntrySheet.tsx` (~:243-277, 444-538): when Estimate succeeds the Estimate button and input unmount and SimpleEntryReview mounts with only `snapToIndex(1)` as a signal; nothing announces the estimate, and focus lands on nothing meaningful. Same on the way back (Edit dish name). Deferred because the timing against the sheet snap animation wants a device check.

## Acceptance Criteria

- [ ] After a successful estimate, screen readers hear the total (e.g. "Estimated, N kcal, M foods") or focus moves to the review heading
- [ ] Edit dish name back to step 1 is announced too
- [ ] Checked with VoiceOver and TalkBack on device

## Implementation Notes

A delayed announce after the snap (announceTogether) is safest. Files: `client/components/meal-plan/SimpleEntrySheet.tsx`, its tests.

## Updates

### 2026-11-21

- Filed from the accessibility audit
