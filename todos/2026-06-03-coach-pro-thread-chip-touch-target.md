---
title: "Fix CoachProScreen thread chip touch targets below 44pt minimum"
status: backlog
priority: low
created: 2026-06-03
updated: 2026-06-03
assignee:
labels: [deferred, accessibility]
github_issue:
---

# Fix CoachProScreen thread chip touch targets below 44pt minimum

## Summary

`CoachProScreen` thread chip `Pressable` elements have `minHeight: 36` with no `hitSlop` — below the WCAG 2.5.5 / project minimum 44×44pt touch target.

## Background

Deferred from 2026-06-03 full audit (L15). File: `client/screens/CoachProScreen.tsx:271-285`.

## Acceptance Criteria

- [ ] Thread chip Pressables either increase `minHeight` to 44 or add `hitSlop={{ top: 4, bottom: 4 }}` to reach 44pt effective target
- [ ] Visual appearance unchanged (hitSlop is invisible)

## Implementation Notes

`hitSlop={{ top: 4, bottom: 4 }}` adds 8pt to the 36pt height = 44pt effective target. Alternatively set `minHeight: 44` if the visual size can change. `hitSlop` is preferred to avoid layout shift.

## Dependencies

- None

## Risks

- None

## Updates

### 2026-06-03

- Initial creation (deferred from full audit L15)
