---
title: A saved nutrition goal of 0 means "no goal" — normalise it to null before any met-the-goal maths
track: knowledge
category: conventions
module: server
tags: [database, api, nutrition, goals]
applies_to: ["server/storage/**/*.ts", "server/services/**/*.ts"]
created: 2026-11-10
---

# A saved nutrition goal of 0 means "no goal"

## Rule

When reading `users.daily_protein_goal` / `daily_carbs_goal` (or any goal the goals
form lets reach 0) for a "met the goal" or ratio calculation, map `<= 0` to `null`
at the read, so every downstream check that means "no goal" (`goal === null`) holds.

## Why

`server/routes/goals.ts` accepts `dailyProteinGoal: z.number().int().min(0)` and
the manual goal form sends what was typed, so 0 is a reachable stored value. Code
that tests `goal === null` treats 0 as a real goal: in the weekly report every day
with any protein logged became "protein on target" (`protein >= 0.9 * 0`), giving a
protein stat, chart and celebration on a 5 g week — exactly what the spec forbids
for a user with no protein goal. `menu-analysis.ts` already treats a falsy goal as
absent; the calorie goal is safe only because its route minimum is 500.

## Examples

`server/storage/weekly-reports.ts` → `positiveOrNull()` in `getWeeklyReportInputs`;
test "treats a saved goal of 0 as no goal" in
`server/storage/__tests__/weekly-reports.test.ts`.

## Exceptions

Displaying the user's own settings back to them: show the 0 they saved.

## Related Files

- `server/routes/goals.ts` — the `min(0)` that makes 0 reachable
- `server/storage/weekly-reports.ts`
