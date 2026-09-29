---
title: "AllConversationsScreen stays mounted and never refetches — same staleness shape #1096 fixed for ChatListScreen"
status: done
priority: low
created: 2026-09-26
updated: 2026-09-26
assignee:
labels: [deferred, client-state]
github_issue:
---

# AllConversationsScreen stays mounted and never refetches — same staleness shape #1096 fixed for ChatListScreen

## Summary

`client/screens/AllConversationsScreen.tsx` reads `useChatConversations` and can stay mounted under a pushed chat screen. After an aborted stream invalidates the conversations with `refetchType: "none"`, it keeps showing the old list until it remounts. That's the same problem #1096 fixed for ChatListScreen and CoachProScreen.

## Background

Flagged by #1096's mobile reviewer as out of scope, because the original todo didn't name this screen.

The reviewer also raised a subtlety in `client/hooks/useRefreshOnFocus.ts`. Its skip-first-focus logic assumes the screen mounts already focused. A screen that mounts _blurred_ would treat its first real refocus as the mount, and skip it. The deep-link path `chat/:conversationId` was checked and doesn't hit this. The in-app path `navigation.navigate("CoachPro", { selectedConversationId })` from AllConversationsScreen was reasoned about but not verified.

## Acceptance Criteria

- [x] AllConversationsScreen picks up changes to the conversation list after returning from an aborted stream (wire `useRefreshOnFocus` with `settleMs: REFRESH_ON_FOCUS_SETTLE_MS`, as ChatListScreen does).
- [x] A test with a stateful `refetch` mock, returning pre-settle data then settled data (the ChatListScreen test shape), proves the list ends up showing settled data.
- [x] Verify or rule out the mounted-while-blurred case for the `navigate("CoachPro", …)` path. If it's real, fix the skip-first heuristic (for example, skip only when the screen is focused at mount) and test it. — **Ruled out** (see Updates below); no `useRefreshOnFocus.ts` change made.

## Implementation Notes

- The pattern is in `client/screens/ChatListScreen.tsx` and `client/screens/__tests__/ChatListScreen.test.tsx` since #1096.
- `useRefreshOnFocus` has other callers (`client/hooks/useLibraryCounts.ts`, `client/hooks/useProfileWidgets.ts`). Any heuristic change must keep their behaviour.

## Scope Contract

- **Files in scope:** `client/screens/AllConversationsScreen.tsx`, its test, and `client/hooks/useRefreshOnFocus.ts` plus its test (only if the blurred-mount case is real).

## Dependencies

- None

## Updates

### 2026-09-29 (implemented)

- **AC1/AC2**: Wired `useRefreshOnFocus(refetchOnFocus, { settleMs: REFRESH_ON_FOCUS_SETTLE_MS })` into `AllConversationsScreen.tsx` around its existing single `useChatConversations(activeSegment, { search })` query's `refetch` — the same pattern `ChatListScreen.tsx` uses since #1096. Because there is only one query (keyed on `activeSegment`) and `refetch` is the same TanStack Query observer's bound method regardless of which segment is active (verified against the pinned `@tanstack/query-core` source during review — `QueryObserver`'s constructor binds `this.refetch` once, and `useBaseQuery` creates that observer once via `React.useState`), wiring the one `refetch` covers whichever tab (Coach or Recipes) is active when the screen regains focus. Test: new `AllConversationsScreen — refetch on refocus (P3-2026-09-26)` describe block in `AllConversationsScreen.test.tsx`, matching `ChatListScreen.test.tsx`'s stateful-refetch-mock shape (pre-settle → settled data across the `REFRESH_ON_FOCUS_SETTLE_MS` follow-up).
- **AC3 — ruled out, no `useRefreshOnFocus.ts` change.** Traced `navigation.navigate("CoachPro", { selectedConversationId: conv.id })` (the existing coach-row press handler, unchanged by this todo) through the pinned `@react-navigation` v7 source (`package.json`: core/native/routers/bottom-tabs all `^7.x`):
  - `CommonActions.navigate()` never sets `action.target` (`node_modules/@react-navigation/routers/lib/module/CommonActions.js:8-33`).
  - Action bubbling (`node_modules/@react-navigation/core/lib/module/useOnAction.js:37-91`) tries the current navigator's own router, then bubbles to ancestors only (`onActionParent`); bubbling to _children_ only fires `if (typeof action.target === 'string' || action.type === 'NAVIGATE_DEPRECATED' || navigationInChildEnabled)` (lines 72-89) — none apply to a bare `.navigate(name, params)` call, and `navigationInChildEnabled` defaults to `false` (`DeprecatedNavigationInChildContext.js`) and is never set on this app's `NavigationContainer` (`client/App.tsx:93-99` — only `ref`/`linking`/`onReady`).
  - `StackRouter`'s own `NAVIGATE` case requires `state.routeNames.includes(action.payload.name)` (`node_modules/@react-navigation/routers/lib/module/StackRouter.js:186-190`). `AllConversationsScreen`'s own navigator is `RootStackNavigator` (it's a direct `<Stack.Screen>` there), whose own `routeNames` do not include `"CoachPro"` (nested two levels down, under `Main → CoachTab → ChatStackNavigator`) — and `RootStackNavigator` is the root of the tree, so there is no further ancestor to bubble up to.
  - **Regardless of whether this bare call actually resolves to CoachProScreen in production** (see the separate, out-of-scope finding below), the mounted-while-blurred window this AC asked about is unreachable on every path: in-app, the only way to reach `AllConversationsScreen` is via `CoachProScreen`'s own "See All" button (`CoachProScreen.tsx:359`), so `CoachTab`'s stack — and `CoachProScreen` — is already mounted before this call can fire; no first mount occurs. Via the cold `conversation-list` deep link (`linking.ts:254`, a root-level path with no nested `CoachTab` state), `CoachTab` is lazy and has never mounted, so `ChatStackNavigator` has never run `useOnAction.js`'s `addListenerParent('action', …)` — there is no listener to receive a bubble-down even if the legacy flag were enabled (confirmed off).
  - **Separate, out-of-scope finding (not fixed here — no AC ties to it, and fixing navigation logic is outside this todo's Scope Contract):** the bare `navigate("CoachPro", { selectedConversationId })` call very likely does not navigate anywhere in production — it doesn't match the explicit nested form (`navigate("Main", { screen: "CoachTab", params: { screen: "CoachPro", params: {...} } })`) this codebase uses correctly elsewhere for an equivalent cross-navigator jump (`AllConversationsScreen.tsx`'s own "no back stack" `navigation.reset(...)` close-fallback handler, and every cross-tab `navigate` call in `HomeScreen.tsx:198-220`). The call predates this todo by months (`git log -S 'navigate("CoachPro"'` → `571ae40b`/`3faa9586`, 2026-05-09, from `todos/archive/2026-05-09-all-conversations-route-param.md`, which already names React Navigation v7 in its Background — not a recent regression). Could not get a clean empirical confirmation (a real-navigator jsdom harness hit an unrelated `@react-navigation/native` import/transform failure in this project's Vitest setup, cost disproportionate to chase further for a P3 todo) — this is a well-evidenced but not 100%-certain finding; surfaced for human decision, severity high (every coach-row tap in `AllConversationsScreen` would silently no-op).
- **Review**: `code-reviewer` + `mobile-reviewer`, one round, both `No blocking findings.` (both independently verified the `refetch` referential-stability claim against the pinned `@tanstack/query-core` source rather than trusting the code comment). Both raised the same WARNING — this Updates section and the AC checkboxes were missing — addressed inline in this edit.
