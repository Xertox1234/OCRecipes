---
title: TDEE back-calculation from intake + weight change for adaptive goals
track: knowledge
category: design-patterns
module: server
tags: [tdee, adaptive-goals, nutrition, algorithm, domain-knowledge]
applies_to: [server/services/adaptive-goals.ts]
created: '2026-02-24'
---

# TDEE back-calculation from intake + weight change for adaptive goals

## When this applies

Whenever the app needs a personalized calorie recommendation, prefer empirical back-calculation of Total Daily Energy Expenditure (TDEE) from the user's actual intake and weight change over a window, rather than a static formula (Mifflin-St Jeor / Harris-Benedict).

## The algorithm

```
actualTDEE = averageIntake - (weightChangeKg * 7700 / days)
```

- `averageIntake` — user's average daily caloric intake over the measurement period
- `weightChangeKg` — `lastWeight - firstWeight` over the period
- `7700` — approximate calories in 1 kg of body weight (accepted exercise-science constant)
- `days` — length of the measurement period

## Examples

Production implementation in `server/services/adaptive-goals.ts`:

1. **Minimum data requirement.** Require at least 4 weight entries spanning at least 14 days. Less data yields unreliable estimates.
2. **Significance threshold.** Only recommend changes when deviation exceeds 10% from current goals. Small adjustments cause user fatigue.
3. **Safety bounds.** Clamp recommended calories to 1200-5000 kcal. Prevents dangerous suggestions when the data is noisy.
4. **Preserve macro ratio.** When adjusting calories, scale protein/carbs/fat proportionally rather than recomputing from scratch — respects the user's intentional macro split.
5. **Goal-aware adjustment.** After TDEE, apply a fixed modifier:
   - Lose weight: `-500 kcal/day` (≈ 0.5 kg/week deficit)
   - Gain/build muscle: `+300 kcal/day` (lean bulk surplus)
   - Maintain: no adjustment

## Why

Static formulas (Mifflin-St Jeor) are accurate within ~10% for most people, but 10% of 2000 kcal is 200 kcal/day — the difference between losing and maintaining weight. Empirical back-calculation uses the user's own data as ground truth, eliminating systematic individual error and adapting to metabolic shifts over time.

## Exceptions

- During the first 14 days, fall back to a static formula (no empirical data yet).
- If the user has wildly inconsistent intake or weight logging, refuse to adjust — the formula amplifies noise.

## Related Files

- `server/services/adaptive-goals.ts`

## See Also

- [Mifflin-St Jeor equation](https://en.wikipedia.org/wiki/Basal_metabolic_rate#BMR_estimation_formulas)
