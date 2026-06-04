---
title: "Fix AdaptiveGoalCard MacroRow dead ternary — both branches return same arrow icon"
status: done
priority: low
created: 2026-06-03
updated: 2026-06-03
assignee:
labels: [deferred, code-quality]
github_issue:
---

# Fix AdaptiveGoalCard MacroRow dead ternary — both branches return same arrow icon

## Summary

`AdaptiveGoalCard` `MacroRow` has a dead ternary: `name={isIncrease ? "arrow-right" : "arrow-right"}` — both branches return the same icon name. `isIncrease` is computed but never used for direction; users get no visual directional cue.

## Background

Deferred from 2026-06-03 full audit (M12). File: `client/components/AdaptiveGoalCard.tsx:63-65`.

## Acceptance Criteria

- [ ] Increasing macro shows upward or increase-directional icon (e.g. `"arrow-up"`)
- [ ] Decreasing macro shows downward or decrease-directional icon (e.g. `"arrow-down"`)
- [ ] Dead ternary replaced with meaningful direction differentiation

## Implementation Notes

Use `name={isIncrease ? "arrow-up" : "arrow-down"}` or equivalent Feather icons. Confirm with the design intent — the `isIncrease` variable is already computed at line 63.

## Dependencies

- None

## Risks

- Visual regression check for both increase/decrease states

## Updates

### 2026-06-03

- Initial creation (deferred from full audit M12)
