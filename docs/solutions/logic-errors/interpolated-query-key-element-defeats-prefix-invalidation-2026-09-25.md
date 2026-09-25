---
title: "Interpolating a variable into a query-key string element defeats prefix invalidation"
track: bug
category: logic-errors
tags: [client-state, tanstack-query, query-key, invalidation, react-native]
module: client
applies_to: [client/hooks/**/*.ts]
symptoms: ["A TanStack Query invalidateQueries({ queryKey: [\"/api/foo\"] }) call refreshes the undated/base variant of a query but a parameterized variant of the same endpoint keeps showing stale data", "Two query hook instances that look like observers of 'the same endpoint' never refetch together after one mutation invalidates it", "A query key is built with a template string like `[`/api/foo${params}`, { ...rest }]` where `params` is an optional `?date=...` suffix"]
created: '2026-09-25'
severity: medium
---

# Interpolating a variable into a query-key string element defeats prefix invalidation

## Problem

`client/hooks/useDailyBudget.ts` built its query key as `[`/api/daily-budget${params}`, { tz }]`, where `params` was `""` (undated) or `?date=2024-06-15` (dated). A mutation invalidating the endpoint called `invalidateQueries({ queryKey: ["/api/daily-budget"] })` — the pattern every other food-log mutation in the app already used correctly for the sibling `/api/daily-summary` endpoint. That invalidation reached the undated query but never the dated one: Home's calorie header refreshed after a food log, but Plan's dated calorie ring (`MealPlanHomeScreen`, via `useDailyBudget(selectedDateStr)`) did not.

## Symptoms

(see frontmatter)

## Root Cause

TanStack Query's default (non-`exact`) `invalidateQueries` match walks the invalidation key array element-by-element and requires each element to be **equal** to the corresponding element of a cached query's key — not a string-prefix or substring match. `invalidateQueries({ queryKey: ["/api/daily-budget"] })` only matches a cached query whose `queryKey[0]` is the exact string `"/api/daily-budget"`. Baking the date into element 0 as `"/api/daily-budget?date=2024-06-15"` makes it a completely different string from the undated key's element 0, so it can never match — this is a REST-URL mental model ("string that starts with X") leaking into a data structure with a different, structural matching rule ("array element equals X").

## Solution

Give every distinguishing parameter its **own** key array element instead of interpolating it into another element's string:

```typescript
// Before — date baked into element 0's URL string
queryKey: [`/api/daily-budget${params}`, { tz }],

// After — date is its own element; undated uses null, never undefined
queryKey: ["/api/daily-budget", date ?? null, { tz }],
```

Use `null` (not `undefined`) for the "absent" slot — TanStack's key hashing treats `undefined` inconsistently across positions in an array, while `null` round-trips predictably. The `queryFn`'s actual HTTP request URL can still interpolate the date into its own query string (`/api/daily-budget${params}`) — only the **cache key** needs the variable pulled out into its own element. With this shape, `invalidateQueries({ queryKey: ["/api/daily-budget"] })` matches every variant's shared `queryKey[0]`, exactly like `invalidateMealPlanItems`'s existing `key[0] === "/api/meal-plan"` predicate already does for meal-plan items.

## Prevention

When adding a query key with an optional or variable segment, ask: "if a mutation invalidates with `queryKey: [<the constant prefix parts only>]`, will it match every variant of this key?" If the variable is baked into a string alongside a constant prefix (rather than living in its own array slot), the answer is no — split it out before shipping the key.

## Related Files

- `client/hooks/useDailyBudget.ts`
- `client/hooks/__tests__/useDailyBudget.test.ts` — the new "prefix invalidation after a food-log mutation" test mounts an undated and a dated `useDailyBudget` query on one shared `QueryClient` and drives a real mutation to prove both refetch
- `client/hooks/useMealPlan.ts` — `invalidateMealPlanItems`'s `key[0] === "/api/meal-plan"` predicate is the same pattern applied correctly

## See Also

- [Coordinated pull-to-refresh for multiple queries](../design-patterns/coordinated-pull-to-refresh-multiple-queries-2026-05-13.md)
- [Timezone-aware day boundaries using Intl.DateTimeFormat](../conventions/timezone-aware-day-boundaries-intl-2026-05-31.md) — documents this same hook's `{ tz }` key segment and a related (but distinct) shared-key caveat
