---
title: "A mutation with TanStack's default networkMode pauses forever offline and fires on reconnect for a screen that is gone"
track: bug
category: logic-errors
tags: [client-state, hooks]
module: client
applies_to: ["client/hooks/**/*.ts", "client/lib/query-client.ts"]
symptoms: ["A spinner that never stops when the user taps while offline", "An in-flight guard ref stays true, so the button never works again", "A request fires minutes later, on reconnect, after the user left the screen", "A test of an offline mutateAsync times out instead of rejecting"]
created: '2026-11-19'
severity: low
---

# A mutation with TanStack's default networkMode pauses forever offline and fires on reconnect

## Problem

TanStack Query v5's default `networkMode: "online"` does not fail an offline
mutation: `mutateAsync` stays pending (paused) until `onlineManager` reports
online, then runs. For a one-shot screen action (recipe import's parse-page /
parse-url) that means a spinner with no timeout, then a request for a screen
that may no longer exist.

## Symptoms

See frontmatter.

## Root Cause

"Online" mode is designed for durable writes that should wait; a user-facing
action that only makes sense now needs to fail fast.

## Solution

Reliability audit 2026-11-19, L-crel-2 — `networkMode: "always"` plus an
explicit check, the same shape as `useNutritionLookup.ts`:

```ts
networkMode: "always",
mutationFn: async (args) => {
  if (!onlineManager.isOnline()) throw new OfflineError();
  …
},
```

`OfflineError` (`client/lib/api-error.ts`) is dropped by
`shouldSurfaceMutationError`, so it never reaches Sentry (silentError
mutations still report since M-obs-4), and screens show "You're offline".

## Prevention

Test with `onlineManager.setOnline(false)`: a paused mutation shows up as a
10 s test timeout — that IS the bug reproducing. Reset to online in `afterEach`.

## Related Files

- `client/hooks/useMealPlanRecipes.ts` — `throwIfOffline`
- `client/lib/api-error.ts` — `OfflineError`
- `client/lib/query-client.ts` — `shouldSurfaceMutationError`

## See Also

- [offline persistence gotchas](../best-practices/offline-persistence-reliability-gotchas-2026-06-19.md)
- [TanStack onlineManager vitest mock](../best-practices/tanstack-online-manager-netinfo-vitest-mock-2026-05-31.md)
