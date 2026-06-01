---
title: "Move ActivityLevel/PrimaryGoal/Gender to shared/ (defined in 3 places)"
status: backlog
priority: medium
created: 2026-05-31
updated: 2026-05-31
assignee:
labels: [deferred, maintainability, typescript]
github_issue:
---

# Consolidate user-goal types into shared/

## Summary

`ActivityLevel`, `PrimaryGoal`, and `Gender` are declared in three places — the server `goal-calculator.ts` (canonical, with a Zod schema), a character-identical client re-declaration in `GoalSetupScreen.tsx`, and an implicit degraded `string | null` in `useDietaryProfileForm`. Move them to `shared/`.

## Background

Found in the 2026-05-31 code-quality re-run (maintainability M11). The client can't import from `server/`, so the duplication is structural — and it has already degraded sibling call sites to `string | null` (effectively untyped). A shared source dissolves the duplication and lets the form state strengthen.

## Acceptance Criteria

- [ ] Move `ActivityLevel`, `PrimaryGoal`, `Gender` + their Zod schemas to `shared/types/user-goals.ts` (or `shared/types/premium.ts`)
- [ ] `server/services/goal-calculator.ts` re-exports / imports from shared; its Zod schema derives from the shared enum values rather than duplicating literals
- [ ] `client/screens/GoalSetupScreen.tsx:44-55` — drop local re-declarations, import from shared
- [ ] `useDietaryProfileForm.ts` (+ `EditDietaryProfileScreen`) — strengthen `string | null` state to the proper unions
- [ ] `npm run check:types` clean; goal-calculation behavior unchanged

## Implementation Notes

- Single source of truth in `shared/`, consumed by both sides. Keep the Zod schema co-located with the union so server validation and client typing can't drift.
- NEVER weaken goal-safety logic while moving types — types only, no behavior change.

## Risks

- Medium — `goal-calculator.ts` feeds nutrition goal math (safety-adjacent). Move the type/schema definitions ONLY; do not alter any calculation. Verify the Zod schema accepts the exact same value set after refactor.

## Updates

### 2026-05-31

- Filed from the 2026-05-31 code-quality re-run, manifest M11.
