---
title: "Document goals calculation system in project docs"
status: done
priority: low
created: 2026-02-08
updated: 2026-02-10
assignee:
labels: [documentation, goals]
---

# Document Goals Calculation System

## Summary

The goal calculation system (macro targets from physical profile) is undocumented. Explore and add documentation.

## Background

Users can set physical profile data (weight, height, age, gender) and have calorie/macro goals calculated automatically. The GoalSetupScreen and goal-calculator service handle this. None of it is documented.

## Acceptance Criteria

- [x] Document GoalSetupScreen in FRONTEND.md
- [x] Document /api/goals/\* endpoints in API.md
- [x] Document server/services/goal-calculator.ts in ARCHITECTURE.md
- [x] Document users table physical profile columns (weight, height, age, gender, macro goals, goalsCalculatedAt) in DATABASE.md

## Implementation Notes

Key files to explore:

- `client/screens/GoalSetupScreen.tsx`
- `server/services/goal-calculator.ts`
- `server/routes.ts` — search for /api/goals endpoints
- `shared/schema.ts` — weight, height, age, gender, dailyProteinGoal, dailyCarbsGoal, dailyFatGoal, goalsCalculatedAt on users table
