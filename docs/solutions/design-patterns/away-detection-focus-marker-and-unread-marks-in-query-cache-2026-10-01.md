---
title: "Tell the user a result landed while they were away: decide 'away' from navigation FOCUS (not unmount), keep the viewed marker and the unread marks in the query cache, and make the consumer opt in"
track: knowledge
category: design-patterns
tags: [react-native, react-navigation, tanstack-query, client-state, hooks, accessibility, toast]
module: client
applies_to: [client/hooks/useCoachUnreadReplies.ts, client/hooks/useChat.ts, client/screens/ChatScreen.tsx, client/navigation/MainTabNavigator.tsx]
created: '2026-10-01'
---

# Tell the user a result landed while they were away

## Rule

When an async result (here, a streamed Coach reply) can finish after the user has left the screen that started it, and the app should tell them (a toast now, a dot on the tab until they look), build it from five parts:

1. **Decide "away" from navigation focus, never from unmount.** The screen reports what it is showing: `useFocusEffect(useCallback(() => viewCoachConversation(queryClient, id), [queryClient, id]))`. Its cleanup runs on blur AND on unmount. The completion handler compares the finished conversation with that marker at the moment it fires.
2. **Keep the marker and the unread marks in the TanStack Query cache** under sentinel keys, so `queryClient.clear()` wipes them on every auth teardown (`query-cache-as-ephemeral-client-store-2026-09-29.md`: pin `gcTime`, clear with `[]`/`null`, never `undefined`). Read the badge with `useQuery({ queryKey, queryFn: skipToken, gcTime: Infinity, select })`.
3. **The consumer opts in.** A hook shared by two screens, where only one reports a viewed marker, misfires for the other. `useSendMessage(id, { notifyWhenAway: true })` is set only by `ChatScreen`; `RecipeChatScreen` never reports a marker, so without the opt-in every recipe reply would flag itself unread while the user is looking at it.
4. **Publish "landed unseen" on a module-level emitter** and let a null-rendering bridge inside the signed-in tree turn it into a toast whose action navigates with the nested form and `{ pop: true }` (`bare-navigate-cannot-descend-into-an-unrelated-nested-navigator-2026-09-29.md`). Record the unread mark where the stream completes (`data.done`), never in `finally`: an aborted, errored or cut-off stream is not a reply the user is waiting on.
5. **Report a reply only to the session that sent it.** The stream is deliberately not aborted on leave or on sign-out, so a reply can finish after `queryClient.clear()`, and after another account signed in; a `done` that then writes a mark re-creates exactly the state the clear removed. Compare the token the send went out with against the current one at `done` time (`tokenStorage.get().then((current) => current === token && ...)`). The token is written only at login/register and every teardown nulls it before the cache is cleared, so a late `done` sees a different token or none; an unreadable token stays quiet. The send epoch cannot be the guard: a pop-back also unmounts the hook and bumps it, and that case must still notify. The guard leans on teardown order: `logout`, `expireSession` and `deleteAccount` in `client/hooks/useAuth.ts` all call `tokenStorage.clear()` before `clearDurableLocalState()` (which ends with `queryClient.clear()`). `docs/rules/client-state.md` requires the same order (token first, cache last; the rule listed the token last until 2026-10-02); reordering the code to clear the cache first would reopen the gap, because a `done` landing between the cache clear and the token clear would still write a mark.

## Smell patterns

- "Away" derived from a hook or screen unmount. A bottom-tab screen stays mounted when its tab loses focus, so the commonest case (a tab switch) is missed.
- A completion handler in a hook with two consumers that records or announces unconditionally.
- A single-slot "currently viewed" marker cleared by a cleanup that does not check it still owns the slot.
- A completion handler that writes session state without checking that the work was started in the CURRENT session: an in-flight request outlives a logout that cleared that state.

## Why

Facts below were measured against the installed versions as of 2026-10-01 (`@react-navigation/core` 7.13.5, `routers` 7.5.2, `@tanstack/react-query` 5.101.0). Re-measure after an upgrade.

- **Focus cascades.** `core/src/useFocusEvents.tsx` has each navigator re-emit its parent screen's `focus`/`blur` for its own focused child, so a root modal pushed over `Main` also blurs a chat screen two navigators down, and a tab switch blurs it without unmounting it.
- **Order trap with a single slot.** When a screen is pushed over another in the same stack, the events are `blur(old)` then `focus(new)`. `useFocusEffect` does not follow that order: the new screen runs its callback in its own mount effect, and the old screen's cleanup only runs on the later blur event. A single-slot marker that the new screen sets is then cleared by the old screen's cleanup. The leave function therefore clears only while the slot still holds its own id (`if (viewed === id)`). Two Chat routes can coexist if a nested navigate omits `pop: true` at the root.
- **`skipToken`, not `enabled: false`.** `skipToken` overrides the app-wide default `queryFn` (so not even an explicit `refetch()` becomes an API call keyed on `__unreadCoachReplies`) and avoids a dev `console.error` on every render in a client with no default `queryFn`, which is every test wrapper. With `select` collapsing the ids to a boolean, the host re-renders only when the answer flips. An unfiltered `invalidateQueries()` never fetches such a key.
- **Notifications are macrotask-batched.** TanStack's `notifyManager` schedules on `setTimeout(0)`, so a cache write reaches React one task later. A test that writes the cache must `waitFor` (or flush one macrotask inside `act`) before asserting on the hook's output, or on its absence.
- **`clear()` and a mounted observer.** `queryClient.clear()` empties the caches but leaves a mounted observer's `data` stale until its host re-renders, and a write after `clear()` is not delivered to it. That is moot here because `MainTabNavigator` unmounts when `isAuthenticated` flips; it matters for any host that survives logout. `setQueryDefaults` survives `clear()`. An unfiltered `resetQueries()`/`removeQueries()` would wipe the sentinels; no client code calls either.
- **The outer `pop` is not forwarded.** `navigate("Main", { screen: "CoachTab", params: { screen: "Chat", params } }, { pop: true })` pops the ROOT stack; the nested navigator receives only a `pop` placed inside the nested params. Navigating to the screen that is already current reuses that instance and replaces its params, so the instance's hook state (an in-flight stream, the typed input) carries over to the other conversation.

## Examples

```tsx
// ChatScreen: report what is on screen. Cleanup = blur AND unmount.
useFocusEffect(
  useCallback(
    () => viewCoachConversation(queryClient, validConversationId),
    [queryClient, validConversationId],
  ),
);

// useSendMessage: the token the send goes out with identifies its session ...
const token = await tokenStorage.get();
// ... and, in the data.done branch only, the reply is reported to that session
// alone (Rule 5) — never unguarded:
if (notifyWhenAway) {
  void tokenStorage.get().then(
    (current) => {
      if (current === token) {
        noteCoachReplyFinished(queryClient, effectiveId);
      }
    },
    () => {
      // Unreadable token: the session can't be told apart, so stay quiet
      // rather than risk a mark for someone else.
    },
  );
}

// MainTabNavigator: one dot for a reminder or an unread reply, and the signal
// for screen readers lives in the tab's own label.
tabBarAccessibilityLabel: hasUnreadCoachReply ? "Coach, new reply" : "Coach",
```

## Exceptions

- A native-stack modal is a separate view controller above the React Native root view that hosts the toast provider, so on iOS the toast is likely hidden while a root modal is up (the mechanism behind `bottom-sheet-from-native-modal-screen-renders-under-the-modal-2026-10-01.md`; not device-verified here). The dot is the durable signal; a toast is one replaceable slot.
- The Coach Pro surfaces use `useCoachStream` and are not wired to this state.

## Related Files

- `client/hooks/useCoachUnreadReplies.ts` — the marker, the marks, the emitter, the badge hook
- `client/hooks/useChat.ts` — `useSendMessage` (`notifyWhenAway`, the `data.done` branch with its send-time token check), `useDeleteConversation` (clears a deleted conversation's mark)
- `client/hooks/useAuth.ts` — the teardown order (token first, cache last) the session guard relies on
- `client/screens/ChatScreen.tsx` — the focus effect
- `client/navigation/MainTabNavigator.tsx` — the dot, the label, the toast bridge, `openCoachConversation`
- `client/hooks/__tests__/useCoachUnreadReplies.test.ts`, `client/navigation/__tests__/MainTabNavigator.test.tsx` — the tests, including the real `StackRouter` check of `pop: true` with a root modal open

## See Also

- [Store ephemeral, session-scoped client state in the TanStack Query cache](query-cache-as-ephemeral-client-store-2026-09-29.md)
- [Bridge an out-of-tree singleton to the in-tree toast via a module-level emitter](module-level-emitter-bridge-out-of-tree-to-toast-2026-05-28.md)
- [A bare navigate(name) called from outside a screen's ancestor chain silently no-ops](../logic-errors/bare-navigate-cannot-descend-into-an-unrelated-nested-navigator-2026-09-29.md)
- [useFocusEffect refires on callback-identity change while the screen is already focused](../conventions/usefocuseffect-refires-on-callback-identity-change-while-focused-2026-09-25.md)
