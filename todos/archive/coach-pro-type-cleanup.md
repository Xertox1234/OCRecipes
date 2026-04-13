---
title: "Coach Pro type and style cleanup"
status: in-progress
priority: low
created: 2026-04-12
updated: 2026-04-12
assignee:
labels: [code-quality, coach-pro, audit-2026-04-12]
---

# Coach Pro Type and Style Cleanup

## Summary

Minor type organization and code style fixes in Coach Pro code. Covers L9, L10, L11, L12 from the 2026-04-12 audit.

## Acceptance Criteria

- [ ] **L9**: Move `MealPlanDay` type to `shared/types/meal-plan.ts` (or inline in navigation types) to remove coach-blocks dependency from core navigation
- [ ] **L10**: Move `CoachChatNavigationProp` from `client/components/coach/CoachChat.tsx` to `client/types/navigation.ts`
- [ ] **L11**: Replace hex suffix concatenation with `withOpacity()` in `CommitmentCard.tsx:59` and `QuickReplies.tsx:26-27`
- [ ] **L12**: Rename `parsed_blocks` to `parsedBlocks` in `server/routes/chat.ts:595`

## Implementation Notes

- All changes are mechanical — no logic changes, no test updates expected.
- L11 uses `withOpacity(theme.link, 0.20)` instead of `theme.link + "33"`, etc.

## Updates

### 2026-04-12
- Created from audit findings L9, L10, L11, L12
