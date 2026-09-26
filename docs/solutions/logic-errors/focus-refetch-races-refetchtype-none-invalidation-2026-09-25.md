---
title: "A focus refetch in the same transition as a refetchType: \"none\" invalidation races the server write the \"none\" was deferring for"
track: bug
category: logic-errors
tags: [client-state, hooks, tanstack-query, react-navigation, invalidation, react-native]
module: client
applies_to: [client/hooks/**/*.ts, client/screens/**/*.tsx, client/components/**/*.tsx]
symptoms: ["A still-mounted list refetches on refocus after a chat stream is aborted but keeps showing the pre-abort state for the full staleTime", "A partial reply or refund the server settles after a client disconnect never appears until a manual pull-to-refresh or a 5-minute staleTime expiry", "invalidateQueries({ refetchType: \"none\" }) fires in an unmount/dismiss cleanup while a sibling screen's useFocusEffect refetches the same key in the same navigation transition"]
created: '2026-09-25'
severity: low
---

# A focus refetch in the same transition as a `refetchType: "none"` invalidation races the server write

## Problem

Chat-stream abort cleanups (`client/hooks/useChat.ts` abort branch, `CoachOverlayContent.tsx`'s
dismiss cleanup, `CoachChat.tsx`'s unmount cleanup) mark the chat queries stale with
`invalidateQueries({ refetchType: "none" })` — deliberately NOT refetching, because the server is
still settling the turn after the disconnect (persist a partial reply, or refund the user message;
`server/routes/chat.ts`, H6). The stale mark defers the read to the next observer mount.

PR #1096 then wired `useRefreshOnFocus` into the screens that stay mounted underneath (ChatList,
CoachPro). But the refocus those screens react to is the SAME navigation transition as the abort:
ChatScreen popping, or the Ask Coach modal dismissing. The focus refetch fires milliseconds after
the abort — before the server's settle lands — so it reads pre-settle data. Worse, a successful
refetch resets `isInvalidated` and `dataUpdatedAt`, so that pre-settle data is now latched as
fresh for the global 5-min `staleTime` (`client/lib/query-client.ts`). The focus refetch undid the
exact protection the `"none"` was there to provide.

## Symptoms

- The list refreshes on return (a network call is visible) but shows the pre-abort state.
- The settled reply appears only after a pull-to-refresh or ~5 minutes.

## Fix

Refetch immediately on refocus (fast path for ordinary returns) AND schedule ONE follow-up refetch
after a settle margin sized from the server's post-disconnect work; clear the pending timer in the
`useFocusEffect` cleanup (blur) and on unmount so it never fires against a blurred/unmounted
screen. Make the follow-up OPT-IN on a shared hook: `useRefreshOnFocus(refetch, { settleMs })` —
its pre-existing Profile hub callers have no such race and keep one refetch per refocus.
`client/hooks/useRefreshOnFocus.ts` exports the margin as `REFRESH_ON_FOCUS_SETTLE_MS`
(2s: the coach path's settle is one SELECT + one write after a synchronous abort, so the dominant
term is the TCP close reaching the server). Tests advance fake timers by the exported constant,
never a hand-copied number.

Size the margin from the server's actual post-disconnect code path, and say in the comment what it
does NOT cover: the recipe/remix path keeps generating and saving the whole reply after a
disconnect, which no fixed margin bounds.

## Prevention

- Whenever a cleanup uses `refetchType: "none"` "to avoid racing the server", search for anything
  else that refetches the same key on the same transition — `useFocusEffect`/`useRefreshOnFocus`
  on the screen being returned to, `refetchOnMount` on a screen being pushed. That second trigger
  reintroduces the race the `"none"` removed.
- A screen-level test should make the mocked `refetch` return pre-settle data on the first call and
  settled data on the delayed call, then assert the rendered list ends on the settled data — a
  "refetch was called on refocus" count cannot tell the racy version from the fixed one
  (`client/screens/__tests__/ChatListScreen.test.tsx`).
- Before wiring a focus refetch, confirm the screen has a REACHABLE stale trigger while it stays
  mounted. #1096 first wired CoachChat too, but its messages key was only ever marked stale by its
  own unmount cleanup, and its host (CoachProScreen, the Coach tab's persistent stack root) never
  unmounts it — the wiring had no trigger and was removed.

## Related Files

- `client/hooks/useRefreshOnFocus.ts` — immediate + settle-margin follow-up, timer cleared on blur/unmount
- `server/routes/chat.ts` — `res.on("close")` + the H6 post-disconnect settle the margin is sized from
- `client/screens/ChatListScreen.tsx`, `client/screens/CoachProScreen.tsx` — the chat callers that
  pass `settleMs`; `client/hooks/useLibraryCounts.ts` / `useProfileWidgets.ts` are the pre-existing
  default-mode callers

## See Also

- [useFocusEffect refires on callback-identity change while focused](../conventions/usefocuseffect-refires-on-callback-identity-change-while-focused-2026-09-25.md)
- [A manual refetch() bypasses TanStack Query's enabled gate](../conventions/manual-refetch-bypasses-tanstack-query-enabled-gate-2026-09-25.md)
