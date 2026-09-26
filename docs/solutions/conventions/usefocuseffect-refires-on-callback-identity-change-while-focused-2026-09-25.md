---
title: "useFocusEffect refires on callback-identity change while the screen is already focused"
track: knowledge
category: conventions
module: client
tags: [react-navigation, react-native, hooks, client-state]
applies_to: [client/screens/**/*.tsx, client/components/**/*.tsx, client/hooks/**/*.ts]
created: '2026-09-25'
---

# useFocusEffect refires on callback-identity change while the screen is already focused

## When this applies

Passing a `useCallback`-wrapped effect to `@react-navigation/native`'s `useFocusEffect`, where the
callback closes over a value that can change while the screen stays mounted and focused (a
`conversationId`, a filter, a selected id).

## Smell patterns

- A `useFocusEffect(useCallback(() => { ... }, [someValue, ...]))` where `someValue` is expected to
  change only via navigation (focus/blur), but can also change from ordinary in-screen state
  updates while the screen is already the focused route.
- A code comment asserting a `useFocusEffect`-driven side effect "only runs on focus/blur" without
  having read the hook's own effect-scheduling logic.

## Why

`useFocusEffect`'s real implementation (`@react-navigation/core/src/useFocusEffect.tsx`) wraps its
argument in a single `React.useEffect(..., [effect, navigation])`. That effect body runs the
callback immediately if `navigation.isFocused()` is true — not only from the `addListener("focus",
...)` subscription. So whenever the `effect` reference changes identity **while the screen is
already focused**, the outer `useEffect` reruns and invokes the callback again immediately, exactly
as if a real focus event had fired. This is not a bug in `useFocusEffect` — the library's own JSDoc
says the callback "should be wrapped in `React.useCallback`" precisely because its identity is the
effect's trigger, not just an optimization.

Two consequences to check for at every call site:

1. If the callback's identity changes for a reason **other than** a genuine navigation transition
   (e.g. a `conversationId` prop that also changes while the tab stays focused), the effect fires
   again on that unrelated change too — which is usually harmless (an idempotent refetch/reset) but
   must be verified, not assumed.
2. Conversely, gating a callback on `useCallback(fn, [])` (no deps) to avoid extra fires means it
   captures **stale** values from the closure forever — the classic stale-closure trap, now hidden
   inside a hook whose whole contract is "runs on focus."

## Examples

```ts
// The wrapped callback's identity changes whenever `conversationId` changes,
// which also refires the effect while the tab stays focused (not just on a
// genuine blur/refocus). Here that's fine: refetchMessages is idempotent, and
// it deduplicates against the new conversation's own mount fetch.
const refetchOnFocus = useCallback(() => {
  if (conversationId !== null) void refetchMessages();
}, [conversationId, refetchMessages]);
useFocusEffect(refetchOnFocus); // via useRefreshOnFocus's own internal useCallback
```

## Exceptions

If the wrapped value never changes for the component's lifetime (e.g. an id passed once at mount,
or a `refetch` function that TanStack Query keeps referentially stable across query-key changes —
see the sibling solution on `enabled`), this refire path never triggers in practice and needs no
special handling beyond the usual `useCallback` deps hygiene.

## Related Files

- `node_modules/@react-navigation/core/src/useFocusEffect.tsx` — the effect-scheduling logic this
  documents (`[effect, navigation]` deps, `navigation.isFocused()` check)
- `client/hooks/useRefreshOnFocus.ts` — the skip-first-focus wrapper this project uses around
  `useFocusEffect`
- `client/components/coach/CoachChat.tsx` — `refetchOnFocus`'s `conversationId` dependency

## See Also

- [A manual refetch() bypasses TanStack Query's enabled gate](manual-refetch-bypasses-tanstack-query-enabled-gate-2026-09-25.md)
