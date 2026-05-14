---
title: "Centralized domain defaults via shared constants"
track: knowledge
category: conventions
tags: [api, shared, constants, defaults, drift]
module: shared
applies_to: ["shared/constants/**/*.ts", "server/**/*.ts", "client/**/*.ts"]
created: 2026-05-13
---

# Centralized domain defaults via shared constants

## Rule

When multiple files use the same fallback value (e.g., `|| 2000` for calories), extract into a single `as const` object in `shared/constants/`. This prevents silent drift where the same default diverges across services.

## Why

Before centralization, meal suggestions used `protein=100` while adaptive goals used `protein=150` — a 50% discrepancy for the same concept. `as const` gives literal types, and a unit test locks down the values against accidental changes.

## Examples

```typescript
// shared/constants/nutrition.ts — single source of truth
export const DEFAULT_NUTRITION_GOALS = {
  calories: 2000,
  protein: 150,
  carbs: 250,
  fat: 67,
} as const;

// Good: All consumers reference the constant
import { DEFAULT_NUTRITION_GOALS } from "@shared/constants/nutrition";
const calories = user.dailyCalorieGoal || DEFAULT_NUTRITION_GOALS.calories;

// Bad: Hardcoded fallbacks that can drift independently
const calories = user.dailyCalorieGoal || 2000;
const protein = user.dailyProteinGoal || 100; // was it 100 or 150?
```

## When to use

2+ files share the same fallback/default value for a domain concept.

## Exceptions

- A value is used in only one place
- The "defaults" are intentionally different per context (document the deviation with a comment)

## See Also

- [Intent-driven config object shared across client/server](../design-patterns/intent-driven-config-object-2026-05-13.md)
