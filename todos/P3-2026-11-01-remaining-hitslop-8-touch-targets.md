---
title: "Last five small icon buttons still rely on hitSlop={8} for their tap area"
status: backlog
priority: low
created: 2026-11-01
updated: 2026-11-01
assignee:
labels: [deferred, client, accessibility]
github_issue:
---

# Last five small icon buttons still rely on hitSlop={8} for their tap area

## Summary

#1673 brought most small icon buttons to a 44pt tap area. Five components were outside its scope and still use `hitSlop={8}`, which may leave them under 44pt.

## Background

Found during #1673 (touch-targets pass, merged 2026-11-01).

## Acceptance Criteria

- [ ] Each site below reaches a 44×44pt tap area using the approach #1673 used, without overlapping neighbouring controls
- [ ] `client/components/__tests__/touch-targets.test.tsx` covers the new sites

## Implementation Notes

Sites on main at 3a07881c (`grep -rn 'hitSlop={8}' client`):

- `client/components/Toast.tsx:188`
- `client/components/UpgradeModal.tsx:380`, `:392`
- `client/components/coach/CoachChat.tsx:1026`
- `client/components/sheet/SheetChrome.tsx:46`
- `client/components/meal-plan/MealSlotSection.tsx:307`

## Scope Contract

- **Mechanisms to use:** the same sizing approach as #1673 — nothing new
- **Files in scope:** the five files above and `client/components/__tests__/touch-targets.test.tsx`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- Bigger tap areas can overlap nearby controls; check each one on a phone with VoiceOver/TalkBack.

## Updates

### 2026-11-01

- Filed by the /todo run (left over from #1673).
