---
title: Health data about other people stays out of the on-device query cache — keep its key out of QUERY_KEYS, fetch it only while the feature is active, and pin both with tests
track: knowledge
category: conventions
tags: [client-state, security, privacy, tanstack-query, health-data]
module: client
applies_to: ["client/lib/query-keys.ts", "client/hooks/useFamily.ts"]
created: 2026-11-16
---

# Health data about other people stays out of the on-device query cache

## Rule

A query that returns health details of someone other than the account holder (family profiles: names, allergies, notes, some of them children):

1. Uses a key builder that is **not** an entry of `QUERY_KEYS`. `App.tsx` persists only queries whose first key element belongs to a `QUERY_KEYS` value, so this is what keeps the data in memory only.
2. Is enabled only while the feature is active (plan known, premium flag on, the user's switch on). A separate hook, mounted only by the management screens, fetches it unconditionally so a lapsed user can still delete.
3. Is removed, not invalidated, when the feature is switched off.
4. Has no `mutationKey` on its mutations, so paused mutations (which carry the name, allergies and note as variables) are never dehydrated.

State kept outside the query cache needs its own handling: a module-level variable (the pending "Who's it for?" choice in `client/lib/plan-audience.ts`, which holds a family profile id) is not reached by `queryClient.clear()`. It needs an expiry and its own call in `clearDurableLocalState`.

## Smell patterns

- A new entry in `QUERY_KEYS` for data about another person.
- A screen outside the feature importing the unconditional list hook.
- A `let` at module scope in `client/lib/**` holding anything tied to the signed-in user, with no call in `clearDurableLocalState`.

## Why

The user's own dietary profile is persisted so the app opens with it offline. The same convenience for family profiles would write other people's health details to device storage, where they outlive the session until the teardown sweep runs. In memory, `queryClient.clear()` at sign-out is enough.

The module variable was found in review: a second person signing in on the same device within the 10-minute expiry, with family planning active, could have had the previous user's choice applied to a meal. The server refuses another account's profile id (404), but a leftover "everyone" would have been applied silently.

## Examples

```ts
// client/lib/query-keys.ts — exported, deliberately not in QUERY_KEYS
export const familyProfilesKey = () => ["/api/family-profiles"] as const;
```

```ts
// client/hooks/auth-session.ts — first line of clearDurableLocalState, before its try block
clearPendingAudience();
```

## Exceptions

A boolean that only says the feature is on (`familyPlanningEnabled` on the persisted dietary profile) is not health data and may be persisted.

## Related Files

- `client/lib/query-keys.ts`, `client/lib/__tests__/query-keys.test.ts`
- `client/hooks/useFamily.ts` — `useFamilyContext` (gated), `useFamilyProfilesList` (management screens)
- `client/lib/plan-audience.ts`, `client/hooks/auth-session.ts`
- `client/App.tsx` — the persistence rule

## See Also

- [clear the query cache on auth teardown](clear-query-cache-on-auth-teardown-2026-05-30.md) — the sweep this adds a line to
- [a mutation that settles before its refetch](../logic-errors/mutation-settles-before-its-refetch-so-pending-ui-flicks-back-2026-11-16.md) — remove, do not invalidate, on switch-off
