---
title: "Meal-plan announcement and label polish"
status: backlog
priority: low
created: 2026-11-21
updated: 2026-11-21
assignee:
labels: [deferred, accessibility, client]
github_issue:
---

# Meal-plan announcement and label polish

## Summary

Accessibility audit 2026-11-21 finding, deferred at triage by the owner (or a part of a fixed finding that needs a design call). Source: `docs/audits/2026-11-21-accessibility.md` (local manifest).

## Background

From the audit: `MealPlanDayScreen.tsx:445-448` audience-change announce is generic and not delayed past the sheet dismiss; `MealPlanHomeScreen.tsx:258-261` week arrows announce nothing; `MealPlanHomeScreen.tsx:438,449` top-action chip icons not hidden and the pantry badge number duplicates the label on Android; `GroceryWriteCard.tsx:48` the Add to radiogroup has no label.

## Acceptance Criteria

- [ ] Each item above fixed or explicitly declined with a reason
- [ ] Tests for the announcements

## Implementation Notes

Files as listed.

## Updates

### 2026-11-21

- Filed from the accessibility audit
