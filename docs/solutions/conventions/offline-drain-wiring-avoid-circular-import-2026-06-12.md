---
title: 'Wire offline queue drain via App.tsx, not query-client.ts, to avoid circular import'
track: knowledge
category: conventions
module: client
tags: [offline-queue, circular-import, tanstack-query, onlineManager, architecture]
applies_to: [client/App.tsx, client/lib/offline-queue-drain.ts, client/lib/query-client.ts]
created: '2026-06-12'
---

# Wire offline queue drain via App.tsx, not query-client.ts, to avoid circular import

## Rule

`offline-queue-drain.ts` imports `apiRequest` and `queryClient` from `query-client.ts`. Never wire `onlineManager.subscribe(drainQueue)` inside `query-client.ts` — that creates a circular dependency (`query-client` → `offline-queue-drain` → `query-client`). Wire it in `App.tsx` instead.

## Why

`client/lib/query-client.ts` is the module that exports both `queryClient` and `apiRequest`. The drain module imports both of these. If `query-client.ts` also imported `drainQueue` from `offline-queue-drain.ts`, the import graph would be circular:

```
query-client.ts
  ↳ offline-queue-drain.ts (imports apiRequest, queryClient)
    ↳ query-client.ts  ← CIRCULAR
```

Metro bundler and Node/Vitest both tolerate some circular imports but produce undefined exports at the point of the cycle — `queryClient` or `apiRequest` would be `undefined` inside `offline-queue-drain.ts`, causing silent runtime failures.

## Examples

**Wrong — wired inside `query-client.ts`:**
```ts
// client/lib/query-client.ts  ← do NOT do this
import { drainQueue } from "@/lib/offline-queue-drain"; // circular!
onlineManager.subscribe((isOnline) => {
  if (isOnline) void drainQueue();
});
```

**Correct — wired at the app entry point:**
```ts
// client/App.tsx
import { onlineManager } from "@tanstack/react-query";
import { drainQueue } from "@/lib/offline-queue-drain";

// At module level, before the navigation tree mounts:
onlineManager.subscribe((isOnline) => {
  if (isOnline) void drainQueue();
});
```

`App.tsx` is a safe wiring point: it imports from both `query-client.ts` (to get `queryClient`) and `offline-queue-drain.ts`, but neither of those modules imports from `App.tsx` — the dependency graph stays acyclic.

## Exceptions

If a future module needs to trigger drain from within the query layer (e.g. a custom mutation observer), extract a thin event-bus module (`drain-events.ts`) that neither `query-client.ts` nor `offline-queue-drain.ts` imports from — then both can emit/subscribe without a cycle.

## Related Files

- `client/App.tsx` — canonical wiring location (`onlineManager.subscribe` call at module level)
- `client/lib/offline-queue-drain.ts` — exports `drainQueue`, imports `apiRequest`/`queryClient`
- `client/lib/query-client.ts` — exports `queryClient`, `apiRequest`, `asyncStoragePersister`
