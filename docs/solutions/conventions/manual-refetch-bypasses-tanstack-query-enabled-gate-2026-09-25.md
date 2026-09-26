---
title: "A manual refetch() bypasses TanStack Query's `enabled` gate"
track: knowledge
category: conventions
module: client
tags: [tanstack-query, react-native, hooks, client-state]
applies_to: [client/hooks/**/*.ts, client/screens/**/*.tsx, client/components/**/*.tsx]
created: '2026-09-25'
---

# A manual refetch() bypasses TanStack Query's `enabled` gate

## When this applies

Calling the `refetch` function `useQuery` returns from any trigger OTHER than the query's own
lifecycle — a `useFocusEffect`/`AppState` listener, a pull-to-refresh handler, a button, a timer —
on a query that was built with `enabled: someCondition`.

## Smell patterns

- `useQuery({ queryKey, enabled: !!id })` paired with a `refetch()` call site that doesn't itself
  check `id` (or whatever `enabled` depends on).
- A "refresh on X" hook (focus, foreground, an external event) wired directly to a query's
  `refetch` without asking whether that query is ever legitimately disabled.

## Why

`enabled` only gates *automatic* fetching — the query's own mount/dependency-change fetch and
background refetch triggers (`refetchOnMount`, `refetchOnWindowFocus`, `refetchOnReconnect`).
`QueryObserver.refetch()` (`@tanstack/query-core`) calls `this.fetch(...)`, which calls the
internal `executeFetch_fn` and then `Query.fetch()` directly — neither checks `options.enabled`
anywhere in the call chain (verified against the pinned `@tanstack/query-core` v5.101.0 source,
`queryObserver.ts`/`query.ts`). A manual `refetch()` therefore always issues (or dedupes into an
already in-flight) request, even while the query is "disabled."

Concretely: `useQuery({ queryKey: [`/api/x/${id}/y`], enabled: !!id })` with `id = null` still
fetches `/api/x/null/y` if something calls `refetch()` on it — the `enabled: false` UI-visible
behavior (no automatic fetch, `status: "pending"`) gives no indication this path exists.

## Examples

```ts
// Bad — refetch() ignores useChatMessages' own `enabled: !!conversationId` gate.
const { refetch } = useChatMessages(conversationId, opts);
useRefreshOnFocus(refetch); // fires /api/chat/conversations/null/messages when conversationId is null

// Good — guard the manual trigger with the SAME condition `enabled` uses.
const { refetch } = useChatMessages(conversationId, opts);
const refetchOnFocus = useCallback(() => {
  if (conversationId !== null) void refetch();
}, [conversationId, refetch]);
useRefreshOnFocus(refetchOnFocus);
```

## Exceptions

If the query has no `enabled` option (always enabled), or the manual trigger is only ever wired up
from a scope where the enabling condition is already guaranteed true (e.g. a screen that only
renders once its data exists), no guard is needed — but say so, since the next reader can't tell
the difference from the call site alone.

## Related Files

- `client/hooks/useRefreshOnFocus.ts` — the focus-refetch hook this gotcha was found wiring up
- `client/components/coach/CoachChat.tsx` — `refetchOnFocus`'s `conversationId !== null` guard
- `client/hooks/useChat.ts` — `useChatMessages`'s `enabled: !!conversationId`

## See Also

- [useFocusEffect refires on callback-identity change while focused](usefocuseffect-refires-on-callback-identity-change-while-focused-2026-09-25.md)
