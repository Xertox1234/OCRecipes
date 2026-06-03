---
title: "Fix CoachProScreen New conversation button touch target below 44pt minimum"
status: backlog
priority: low
created: 2026-06-03
updated: 2026-06-03
assignee:
labels: [deferred, accessibility]
github_issue:
---

# Fix CoachProScreen New conversation button touch target below 44pt minimum

## Summary

`CoachProScreen` "New" conversation button has `minHeight: 36` with no `hitSlop` — below the WCAG 2.5.5 / project minimum 44×44pt touch target.

## Background

Deferred from 2026-06-03 full audit (L16). File: `client/screens/CoachProScreen.tsx:361`. Same class of issue as L15 (thread chip) but a distinct element.

## Acceptance Criteria

- [ ] New button Pressable has `hitSlop={{ top: 4, bottom: 4 }}` or `minHeight: 44`
- [ ] Button remains visually unchanged if hitSlop is used

## Implementation Notes

Same fix as L15 — add `hitSlop={{ top: 4, bottom: 4 }}` at line 361.

## Dependencies

- Can be fixed together with L15 (coach-pro-thread-chip-touch-target)

## Risks

- None

## Updates

### 2026-06-03

- Initial creation (deferred from full audit L16)
