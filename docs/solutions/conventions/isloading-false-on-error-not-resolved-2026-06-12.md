---
title: isLoading=false on query error does not mean data resolved — use a data-presence sentinel for mount-once gates
track: knowledge
category: conventions
module: client
tags: [client-state, tanstack-query, navigation, premium-gate]
applies_to: [client/context/**/*.tsx, client/navigation/**/*.tsx, client/hooks/**/*.ts]
created: '2026-06-12'
---

# isLoading=false on query error does not mean data resolved — use a data-presence sentinel for mount-once gates

## Rule

Never gate a **mount-once decision** (e.g., React Navigation `initialRouteName`) solely on `!isLoading` from a TanStack Query result. When a query errors, `isLoading` becomes `false` while `data` remains `undefined` — so the default/fallback value masquerades as a genuinely resolved value.

Use `data !== undefined` (or a named `isXxxResolved` boolean derived from it) as the "has ever succeeded" sentinel instead.

## Why

In TanStack Query v5, `isLoading` (≡ `status === 'pending'`) is only `true` while the query has never yet returned data **and** is currently fetching. After the retry budget is exhausted on a 5xx error:

- `isLoading` → `false`  
- `isError` → `true`  
- `data` → `undefined`

Any `?? default` fallback applied to `data` now looks identical to a legitimate "resolved as the default value." Consumers that keyed their gate on `!isLoading` see `isLoading=false` and proceed — using the fallback as if it were the real resolved value.

For React Navigation's `initialRouteName`, this is particularly harmful: the prop is evaluated **once at mount**. If the navigator mounts while `data` is still `undefined` (error state), the free-tier default is baked in for the entire session.

## Smell patterns

- `if (!isLoading) { /* use data ?? DEFAULT */ }` where the code path is irreversible (navigator mount, cached write, etc.)
- `isLoading` exposed from context where the context also applies `?? DEFAULT` to the raw query data
- A context's `isLoading` is a union of several queries (`isALoading || isBLoading`) — all sub-queries can be done but data for the critical one can be `undefined` (errored)

## Examples

**Wrong — gates on !isLoading, misses the error case:**

```tsx
const { isLoading } = usePremiumContext();
if (isLoading) return <Spinner />;
// Proceeds here even when subscription query errored → coachPro=false default
return <Stack initialRouteName={isCoachPro ? "CoachPro" : "ChatList"} />;
```

**Correct — gates on isPremiumResolved (data !== undefined):**

```tsx
// In PremiumContext.tsx:
const isPremiumResolved = subscriptionData !== undefined;

// In ChatStackNavigator.tsx:
const { isPremiumResolved, isError, refreshSubscription } = usePremiumContext();

if (isError && !isPremiumResolved) {
  // Error with no cached data: show retry affordance (not a permanent spinner)
  return <RetryView onRetry={refreshSubscription} />;
}
if (!isPremiumResolved) {
  // Still loading (first fetch in flight): show spinner
  return <Spinner />;
}
// Only here can we trust coachPro=false means genuinely free
return <Stack initialRouteName={isCoachPro ? "CoachPro" : "ChatList"} />;
```

## Exceptions

- If the fallback/default value is semantically identical to "not loaded" (e.g., empty arrays that start empty and may stay empty), `!isLoading` is safe.
- If the gate is **not mount-once** (re-evaluated on each render), a wrong initial value self-corrects on the next render once the query succeeds. The rule applies strictly to irreversible decisions.
- The error branch **must not be a permanent spinner** — after retries exhaust, `isPremiumResolved` stays `false` forever. Always pair the sentinel gate with an explicit error branch that renders a retry affordance.

## Related Files

- `client/context/PremiumContext.tsx` — exposes `isPremiumResolved` and `refreshSubscription`
- `client/navigation/ChatStackNavigator.tsx` — uses the sentinel gate with error branch
- `client/context/__tests__/PremiumContext.test.ts` — regression tests: pending / success / error / recovery paths

## See Also

- TanStack Query v5 status/fetchStatus matrix: `status: 'error'` sets `isLoading=false` while `data` stays `undefined`
