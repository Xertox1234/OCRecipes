---
status: complete
priority: p3
issue_id: "010"
tags: [type-safety, backend, typescript]
dependencies: []
---

# Tighten Record key types

## Problem Statement

`Record<string, number>` and `Record<string, {...}>` types are too loose for ACTIVITY_MULTIPLIERS, GOAL_MODIFIERS, and MACRO_SPLITS constants.

## Findings

- Location: `server/services/goal-calculator.ts`
- ACTIVITY_MULTIPLIERS uses `Record<string, number>`
- GOAL_MODIFIERS uses `Record<string, number>`
- MACRO_SPLITS uses `Record<string, {...}>`
- Typos in key access not caught at compile time

## Proposed Solutions

### Option 1: Use specific union types for keys

- **Pros**: Compile-time safety, autocomplete support, catches typos
- **Cons**: Slightly more verbose
- **Effort**: Small
- **Risk**: Low

```typescript
type ActivityLevel = "sedentary" | "light" | "moderate" | "active" | "athlete";
type PrimaryGoal = "lose_weight" | "gain_muscle" | "maintain" | "eat_healthier" | "manage_condition";

const ACTIVITY_MULTIPLIERS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  athlete: 1.9,
};

const GOAL_MODIFIERS: Record<PrimaryGoal, number> = { ... };

const MACRO_SPLITS: Record<PrimaryGoal, { protein: number; carbs: number; fat: number }> = { ... };
```

## Recommended Action

Implement Option 1 - define union types and use as Record keys.

## Technical Details

- **Affected Files**: `server/services/goal-calculator.ts`
- **Related Components**: Goal calculation logic
- **Database Changes**: No

## Resources

- Original finding: Code review (kieran-typescript-reviewer)

## Acceptance Criteria

- [ ] ActivityLevel union type defined
- [ ] PrimaryGoal union type defined
- [ ] ACTIVITY_MULTIPLIERS uses `Record<ActivityLevel, number>`
- [ ] GOAL_MODIFIERS uses `Record<PrimaryGoal, number>`
- [ ] MACRO_SPLITS uses `Record<PrimaryGoal, {...}>`
- [ ] Type errors caught at compile time for invalid keys
- [ ] Tests pass
- [ ] Code reviewed

## Work Log

### 2026-02-01 - Approved for Work

**By:** Claude Triage System
**Actions:**

- Issue approved during triage session
- Status: ready
- Ready to be picked up and worked on

**Learnings:**

- Use union types for Record keys instead of `string`
- Enables compile-time checking and autocomplete

## Notes

Source: Triage session on 2026-02-01
