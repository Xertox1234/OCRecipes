---
title: "Coach and notebook controls under 44pt"
status: backlog
priority: low
created: 2026-11-21
updated: 2026-11-21
assignee:
labels: [deferred, accessibility, client]
github_issue:
---

# Coach and notebook controls under 44pt

## Summary

Accessibility audit 2026-11-21 finding, deferred at triage by the owner (or a part of a fixed finding that needs a design call). Source: `docs/audits/2026-11-21-accessibility.md` (local manifest).

## Background

`client/screens/NotebookEntryScreen.tsx:470, 716-720` type chips (~32pt, no room for hitSlop); `client/screens/NotebookScreen.tsx:~271-293` + Add pill and close X; `client/screens/CoachProScreen.tsx:346-347, ~479-490` conversation chips (minHeight 36) and "See all"; `client/components/coach/blocks/QuickReplies.tsx:67-80` reply chips (~38pt, slop clipped). hitSlop never extends past the parent (RN docs, both platforms).

## Acceptance Criteria

- [ ] Each target is a real 44pt box (touch-targets.test.tsx pattern)
- [ ] No visual regression

## Implementation Notes

Wrap in a 44pt target around the unchanged visual, as Chip now does. Files as listed.

## Updates

### 2026-11-21

- Filed from the accessibility audit
