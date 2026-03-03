---
title: "Fix 2 remaining raw res.json() error responses in nutrition.ts"
status: pending
priority: p2
created: 2026-02-25
updated: 2026-02-25
assignee:
labels: [code-review, consistency, error-handling]
---

# Fix 2 remaining raw res.json() error responses in nutrition.ts

## Summary

Two error responses in `server/routes/nutrition.ts` still use raw `res.status(400).json()` instead of `sendError()` — the only holdouts in all 24 route files.

## Background

Found by: pattern-recognition-specialist (E1), kieran-typescript-reviewer (M3)

**File:** `server/routes/nutrition.ts`, lines 260-262 and 297-299

## Acceptance Criteria

- [ ] Both occurrences replaced with `sendError(res, 400, "Invalid item ID", "INVALID_ITEM_ID")`
- [ ] Zero raw `.json()` error responses remain in route files

## Updates

### 2026-02-25
- Created from code review (7-agent parallel review)
