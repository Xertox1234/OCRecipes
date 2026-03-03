---
title: "Standardize DELETE response pattern across routes"
status: pending
priority: p3
created: 2026-02-25
updated: 2026-02-25
assignee:
labels: [code-review, consistency]
---

# Standardize DELETE response pattern across routes

## Summary

DELETE operations use two different patterns: 7 routes return `204 No Content`, 5 routes return `200 { success: true }`. Should standardize on one.

## Background

Found by: pattern-recognition-specialist (F1)

Routes using 200: weight.ts, medication.ts, menu.ts, chat.ts, exercises.ts.
Routes using 204: meal-plan.ts, nutrition.ts, pantry.ts, grocery.ts, recipes.ts, saved-items.ts.

204 is more RESTful and is the majority pattern.

## Acceptance Criteria

- [ ] All DELETE endpoints use `res.status(204).send()` pattern
- [ ] Client code updated if it relies on the `{ success: true }` response body

## Updates

### 2026-02-25
- Created from code review (7-agent parallel review)
