---
title: Query error retry pattern with accessible Retry button
track: knowledge
category: design-patterns
module: client
tags: [react-native, tanstack-query, error-handling, retry, accessibility]
applies_to: [client/screens/**/*.tsx, client/components/**/*.tsx]
created: '2026-05-13'
last_updated: '2026-05-28'
---

# Query error retry pattern with accessible Retry button

## When this applies

Provide retry functionality for failed data fetching with accessible controls. Users should always have a way to recover from transient errors without navigating away.

## Examples

```typescript
const { data, isLoading, isError, refetch } = useQuery({
  queryKey: ["/api/dietary-profile"],
  // ...
});

// In error UI
{isError && (
  <View style={styles.errorContainer}>
    <ThemedText>Failed to load preferences</ThemedText>
    <Pressable
      onPress={() => refetch()}
      accessibilityLabel="Retry loading dietary preferences"
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.retryButton,
        { opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <Feather name="refresh-cw" size={14} />
      <ThemedText>Retry</ThemedText>
    </Pressable>
  </View>
)}
```

## Why

Users should always have a way to recover from transient errors without navigating away. The retry button provides an immediate action rather than requiring a pull-to-refresh or screen reload.

## Shared-hook meta passthrough

When the failing query lives in a shared hook used by multiple screens (e.g. `useDailyBudget`), do **not** hardcode `meta: { silentError: true }` inside the hook — that would silence the global `QueryCache.onError` toast for every caller, including screens that have no inline error UI, re-introducing silent failures. Instead give the hook an optional `options` arg, e.g.

```typescript
useDailyBudget(date?, options?: { meta?: QueryErrorMeta })
```

and pass `options?.meta` straight to `useQuery`. Only the screen that renders its own inline error+retry UI passes `{ meta: { silentError: true } }`; the hook's other callers keep the global toast backstop. The `meta` object is never part of the queryKey, so a fresh literal per render is harmless (no refetch/reinit).

## Error gate before zero-defaulting (data-integrity)

On screens that zero-default missing fields with `?? 0` (calorie/macro totals, item counts), gate `isError` as an **early return** placed after the `isLoading` return but before any zero-defaulting render. Otherwise a failed query renders defaulted zeros ("0 consumed", "0 items logged") against a real goal and presents a network failure as legitimate zero-intake data — worse than a blank screen because nothing looks broken.

Combine the per-query `isError` flags (e.g. `const isError = budgetError || summaryError || goalsError`) and the per-query `refetch` fns into one coordinated `Promise.all` retry handler. Distinguish three visually-distinct states: loading (spinner), error (retry affordance), and genuinely-empty (a 200 with an empty payload, where 0 is a legitimate value and must still render normally).

## See Also

- [Error feedback: toast.error + haptics](error-feedback-toast-error-haptics-2026-05-13.md)
- [Coordinated pull-to-refresh for multiple queries](coordinated-pull-to-refresh-multiple-queries-2026-05-13.md)
