---
title: Bridge an out-of-tree singleton to the in-tree toast via a module-level emitter
track: knowledge
category: design-patterns
module: client
tags: [tanstack-query, error-handling, toast, client-state, client]
applies_to: [client/lib/query-client.ts, client/components/QueryErrorToastBridge.tsx]
created: '2026-05-28'
last_updated: '2026-05-28'
---

# Bridge an out-of-tree singleton to the in-tree toast via a module-level emitter

## When this applies

You have module-level code (constructed once, outside the React tree) that needs
to drive a hook-based UI primitive — e.g. the `QueryClient` in
`client/lib/query-client.ts` wanting to show a toast from a global
`QueryCache.onError`. The module cannot call `useToast()` (no React context at
module scope), and the toast provider sits _inside_ `QueryClientProvider` in the
tree, so there is no parent the module can read from.

Use this when adding any app-wide "net" that lives on the client singleton:
global query/mutation error handlers, global cache callbacks, etc.

## Why

`query-client.ts` runs at import time, before any component mounts. A
hook-based API (`useToast`) is only callable from inside the tree. Coupling
`ToastContext.tsx` to `query-client` directly would invert the dependency and
risk import cycles. A tiny module-level emitter decouples the two: the singleton
_publishes_ events, and one top-level component _subscribes_ and renders.

## Examples

Module side (`client/lib/query-client.ts`) — a `Set` of listeners + a pure,
exported filter so the decision logic is unit-testable without importing the
side-effectful module wholesale:

```typescript
type QueryErrorListener = (message: string) => void;
const queryErrorListeners = new Set<QueryErrorListener>();

export function subscribeToQueryErrors(l: QueryErrorListener): () => void {
  queryErrorListeners.add(l);
  return () => {
    queryErrorListeners.delete(l);
  };
}

const queryCache = new QueryCache({
  onError: (error, query) => {
    if (!shouldSurfaceQueryError(error, query.meta)) return;
    queryErrorListeners.forEach((l) => l(GLOBAL_QUERY_ERROR_MESSAGE));
  },
});
export const queryClient = new QueryClient({ queryCache, defaultOptions: { ... } });
```

Tree side (`client/components/QueryErrorToastBridge.tsx`) — renders `null`, just
wires the subscription to the hook:

```tsx
export function QueryErrorToastBridge(): null {
  const toast = useToast();
  useEffect(() => subscribeToQueryErrors((m) => toast.error(m)), [toast]);
  return null;
}
```

Render it once as a sibling inside `<ToastProvider>` in `App.tsx` (next to
`<OfflineBanner />`, which already consumes the toast the same way).

## Exceptions / gotchas

- **TanStack Query v5 cache-level `onError` fires _in addition to_ each
  observer's local `onError`.** With ~30+ files already defining mutation
  `onError`, a global _mutation_ handler would double-toast. Scope the global net
  to **queries** (which mostly lack handlers) and/or gate it behind a `meta`
  flag. Document the chosen mutation policy in a comment at the construction site
  — the acceptance criteria for this kind of change require it.
- **Suppress expected errors.** Reuse the file's existing `/^4\d\d:/` message
  guard to skip 4xx (screens already branch on these); it also covers the
  `on401: "throw"` auth-redirect path (message `"401: ..."`) and `429`. Only
  transient/5xx/network failures should surface the backstop toast.
- **Per-screen opt-out:** add a `meta: { silentError: true }` flag on queries
  whose screen renders its own error UI, so the global net does not duplicate it.
  Keep the filter (`shouldSurfaceQueryError(error, meta)`) pure and exported for
  direct unit testing — the module's import-time `new QueryClient(...)` side
  effect is why the legacy `query-client.test.ts` recreated logic instead of
  importing; a pure export avoids that anti-pattern.
- **Shared query key `meta.silentError` trap.** When the same query key is observed by multiple `useQuery` calls (e.g. `HomeScreen` and `DailySummaryHeader` both call `useDailyBudget()` for `/api/daily-budget`), the per-screen opt-out flag `meta: { silentError: true }` **must** be passed identically from **every** observer of that key. In TanStack Query v5 the cache entry's `meta` is taken from the most-recently-set-up observer, so if two observers of the same key disagree on `silentError`, whether the global error toast is suppressed becomes render‑/mount‑order dependent (non‑deterministic). The fix used: the shared hook (`useDailyBudget`) gained an optional `{ silentError }` argument, and **both** call sites pass `{ silentError: true }`; the carousel hooks (single‑observer, Home‑only) set `meta: { silentError: true }` at the hook level instead.
- **Dedup is free if the toast provider replaces rather than appends.**
  `ToastProvider.show` calls `setToasts([{...}])`, so an offline storm of failing
  queries collapses to one visible toast. Do not add a coalescing queue.
- **Shared hooks and `meta.silentError` trap.** When the failing query lives in a
  hook shared by multiple consumers (e.g. `useChatMessages` used by `CoachChat`,
  `ChatScreen`, `RecipeChatScreen`, `CoachOverlayContent`), do NOT set
  `meta.silentError` on the hook's internal `useQuery` — that silences the
  global toast for all consumers, stripping the backstop from those with no
  inline error UI. Instead, thread an optional `meta?: QueryErrorMeta` parameter
  through the hook signature and pass it to `useQuery`, so only the consumer
  rendering its own inline error opts out while the rest keep the global toast.

## Related Files

- `client/lib/query-client.ts` — `subscribeToQueryErrors`, `shouldSurfaceQueryError`, the `QueryCache` net
- `client/components/QueryErrorToastBridge.tsx` — the in-tree subscriber
- `client/App.tsx` — bridge rendered inside `<ToastProvider>`
- `client/context/ToastContext.tsx` — `useToast`, `show` (replace-not-append)
- `client/navigation/navigationRef.ts` — precedent for a module-level ref bridging out-of-tree code into the tree

## See Also

- `docs/solutions/design-patterns/per-query-queryfn-overrides-extra-headers-2026-05-13.md` — the other `query-client.ts` extension pattern
- `docs/LEARNINGS.md` — "mutate onError Missing cancelled Guard" (local mutation-handler convention)
