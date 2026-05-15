---
title: "Security: storage-layer defense-in-depth + magic-byte validation (2026-04-28 audit)"
status: in-progress
priority: medium
created: 2026-04-28
updated: 2026-04-28
assignee:
labels: [security]
---

# Security: Storage-Layer Defense-in-Depth + Magic-Byte Validation

## Summary

Three storage functions lack `userId` in their WHERE clauses (relying entirely on route-level ownership checks), and one photo upload endpoint is missing magic-byte file validation.

## Background

From the 2026-04-28 audit (M1, L1, L2, L3). All current call sites correctly verify ownership at the route level, so no IDOR is currently exploitable — but the storage functions are not independently safe. `cooking.ts` photo upload skips the `detectImageMimeType()` check that every other photo endpoint performs.

## Acceptance Criteria

- [ ] **M1** `POST /api/cooking/sessions/:id/photos` (`cooking.ts:212`) — add `detectImageMimeType(req.file.buffer)` check before base64 encoding, matching the pattern in `photos.ts:115`
- [ ] **L1** `getChatMessages` (`chat.ts:60`) — add optional `userId` parameter and include it in WHERE clause when provided
- [ ] **L2** `getMealPlanRecipe` / `getMealPlanRecipeWithIngredients` (`meal-plans.ts:65,75`) — add `userId` parameter and filter
- [ ] **L3** `updateGroceryListItemChecked`, `deleteGroceryListItem`, `updateGroceryListItemPantryFlag` (`grocery-lists.ts:135`) — add `userId` via JOIN to grocery_lists ownership check

## Implementation Notes

For L1, the `userId` param should be optional to avoid breaking the few call sites that pre-validate ownership. For L2-L3, the route-level call sites must be updated to pass `req.userId`.

## Dependencies

None — these are independent, non-breaking changes.

## Updates

### 2026-04-28

- Created from audit findings M1, L1, L2, L3
