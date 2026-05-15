---
title: "Coach Pro hardening — data quality, SSE guard, defense-in-depth"
status: backlog
priority: medium
created: 2026-04-12
updated: 2026-04-12
assignee:
labels: [security, data-integrity, coach-pro, audit-2026-04-12]
---

# Coach Pro Hardening

## Summary

Address remaining medium and low data quality issues across Coach Pro. Covers M2, M6, M10, L1, L2, L3, L4, L5, L13 from the 2026-04-12 audit.

## Acceptance Criteria

- [ ] **M2**: Add per-screen param validation to `navigateActionSchema` (e.g., `NutritionDetail` requires `{ barcode: string }`, `FeaturedRecipeDetail` requires `{ recipeId: number }`)
- [ ] **M6**: Add `SSE_MAX_RESPONSE_BYTES` check to coach and coach-pro streaming loops (matching recipe/remix path at line 385)
- [ ] **M10**: Fix duplicate user message in notebook extraction — either exclude user message from `messageHistory` or don't append it again in `allMessages`
- [ ] **L1**: Sanitize tool call error messages before adding to AI context — use generic message, log details server-side
- [ ] **L2**: Add content length check in `createNotebookEntries` storage function as defense-in-depth
- [ ] **L3**: Fix `shouldUpdateStrategy(0)` — change to `currentCount > 0 && currentCount % 5 === 0`
- [ ] **L4**: Replace hardcoded `proteinGoal = 150` with actual `user.dailyProteinGoal` (requires fetching user record)
- [ ] **L5**: Map allergy objects to strings in coach-context route (matching chat route format)
- [ ] **L13**: Handle or exclude `"system"` role in notebook-extraction.ts type assertion

## Implementation Notes

- M2 requires a discriminated union or per-screen Zod schema for params. Could use `z.discriminatedUnion` keyed on screen name.
- M10: The simplest fix is removing the re-appended user message from the `allMessages` array since `messageHistory` already includes it.
- L4: Add `storage.getUser(req.userId)` to the `Promise.all` in coach-context.ts.

## Updates

### 2026-04-12

- Created from audit findings M2, M6, M10, L1, L2, L3, L4, L5, L13
