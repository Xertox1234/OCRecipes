---
title: "Photo-analysis follow-up sheet overflows at the largest text sizes"
status: backlog
priority: low
created: 2026-11-21
updated: 2026-11-21
assignee:
labels: [deferred, accessibility, client]
github_issue:
---

# Photo-analysis follow-up sheet overflows at the largest text sizes

## Summary

Accessibility audit 2026-11-21 finding, deferred at triage by the owner (or a part of a fixed finding that needs a design call). Source: `docs/audits/2026-11-21-accessibility.md` (local manifest).

## Background

`client/components/photo-analysis/FollowUpModal.tsx` is `position: absolute` with no scroll; at accessibility text sizes the question, input and buttons can run off-screen (audit M8, the part not fixed in place).

## Acceptance Criteria

- [ ] The sheet scrolls or caps its height from the window at large text
- [ ] Checked at the largest Dynamic Type / font scale on both platforms

## Implementation Notes

See docs/solutions/logic-errors/bottom-sheet-fixed-height-cuts-off-its-buttons-when-content-grows-2026-11-16.md. File: FollowUpModal.tsx.

## Updates

### 2026-11-21

- Filed from the accessibility audit
