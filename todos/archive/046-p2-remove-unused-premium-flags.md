---
title: "P2: Remove unused premium feature flags for meal planning"
status: backlog
priority: medium
created: 2026-02-06
updated: 2026-02-06
assignee:
labels: [code-quality, p2, meal-plan, cleanup]
---

# P2: Remove unused premium feature flags for meal planning

## Summary

Seven meal planning feature flags were added to `shared/types/premium.ts` but are never checked anywhere in the codebase. Pure YAGNI.

## Background

`shared/types/premium.ts:19-24, 39-43, 49-57` — flags for `mealPlanning`, `aiMealSuggestions`, `extendedPlanRange`, `pantryTracking`, `mealConfirmation`, `dailyAiSuggestions`, `maxPlanDays` exist but no route, hook, or screen ever reads them.

## Acceptance Criteria

- [ ] Remove unused meal planning fields from `PremiumFeatures` type
- [ ] Remove corresponding values from `TIER_FEATURES` config
- [ ] No TypeScript errors (`npm run check:types`)
- [ ] Re-add when premium gating is actually implemented

## Dependencies

- None

## Updates

### 2026-02-06

- Created from multi-agent code review of `feat/meal-planning-phase-1`
