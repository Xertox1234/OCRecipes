---
title: "Coach reply ready: toast + red dot on the Coach tab when a reply finishes after the user left the chat"
status: in-progress
priority: medium
created: 2026-09-29
updated: 2026-09-29
assignee:
labels: [react-native, client-state, ux, accessibility]
github_issue:
---

# Coach reply ready: toast + red dot on the Coach tab

## Summary

When a Coach reply finishes streaming after the user has left that chat, tell them. Show a toast ("Coach replied — tap to open") at the moment it lands, and a red dot on the Coach tab icon until they open that conversation.

## Background

User rulings, 2026-09-29:

1. **Leaving a Coach chat mid-reply keeps the reply running.** Shipped in #1183: `useSendMessage`'s unmount effect only bumps the epoch; it never aborts an XHR that was already sent. The reply finishes, and the done handler refreshes the conversation.
2. **Such a reply gets BOTH a toast and a red dot**, chosen over dot-only and toast-only.

Today nothing tells the user that the reply arrived. They only find it if they go back to that conversation. This todo depends on #1183 being merged.

## Acceptance Criteria

- [ ] When `useSendMessage`'s done handler (`data.done`) runs while the user is NOT viewing that conversation, the conversation is recorded as having an unread reply. "Not viewing" means the chat screen for that `conversationId` is not focused. That covers both leaving by popping back (the screen unmounts) and switching to another tab (the screen stays mounted: bottom tabs keep visited screens alive, and `CoachTab` sets neither `unmountOnBlur` nor `detachInactiveScreens`). An unmount-only signal would miss the tab-switch case, which is the most common. A reply that finishes while the user is viewing that conversation records nothing. Tests cover all three: viewing, popped back, and switched tab. RED first.
- [ ] A toast shows at that moment: "Coach replied — tap to open". Tapping it opens that conversation. It uses the out-of-tree toast bridge (`docs/solutions/design-patterns/module-level-emitter-bridge-out-of-tree-to-toast-2026-05-28.md`) with an action (`docs/solutions/design-patterns/toast-with-action-button-undo-2026-05-13.md`), and navigates through `client/navigation/navigationRef.ts` using the nested form with `pop: true`: `navigationRef.navigate("Main", { screen: "CoachTab", params: { screen: "Chat", params: { conversationId } } }, { pop: true })`. Two traps (see `docs/solutions/logic-errors/bare-navigate-cannot-descend-into-an-unrelated-nested-navigator-2026-09-29.md`): a bare `navigate("Chat")` from outside its navigator is silently dropped, and without `pop: true` a toast tapped while a root modal is open pushes a SECOND Main route instead of returning to the existing one. Test both the plain case and "modal open when tapped".
- [ ] The Coach tab icon shows a red dot while any conversation has an unread reply. `client/navigation/MainTabNavigator.tsx` ALREADY draws a dot on the Coach tab icon for pending reminders (`hasPending` from `usePendingReminders()`, `styles.dot` inside `iconWrapper`, top-right). Compose with it (one dot for `hasPending || hasUnreadReply`, or a clearly distinct second marker). Don't add an overlapping one, and keep the reminder dot's behaviour unchanged. The dot has an accessible label (e.g. "Coach, new reply") so VoiceOver and TalkBack users get the same signal. Follow `docs/rules/accessibility.md`.
- [ ] Opening that conversation clears its unread mark. The dot disappears when no unread marks remain.
- [ ] Unread marks don't survive logout. Store them where every auth teardown path already clears them: the query cache via `queryClient.clear()`, following `docs/solutions/design-patterns/query-cache-as-ephemeral-client-store-2026-09-29.md` (pin `gcTime: Infinity`, never write `undefined` expecting a clear). The badge must re-render when marks change, so read them through an observer (`useQuery`/`useSyncExternalStore`), not a one-off `getQueryData`.
- [ ] Recipe/remix chats are out of scope: RecipeChatScreen aborts on leave, and its finish-and-save path already has its own post-abort polling (#1171).

## Implementation Notes

- `client/hooks/useChat.ts` → `useSendMessage`: the done branch (`if (data.done) { receivedDone = true; invalidateQueries(...) }`) is where a reply finishes. Record the mark there, not in `finally`: an aborted, errored or cut-off stream is not a "reply ready". To know whether the user is viewing that conversation, keep a small "currently viewed conversation" value that `ChatScreen` sets on focus and clears on blur (`useFocusEffect` or `navigation.addListener("focus"/"blur")`; both fire on tab switches). The done handler compares `effectiveId` against it. Don't key on the hook's unmount.
- `useSendMessage` has two consumers: `ChatScreen` (the Coach chat opened from the chat list, route `Chat` in `client/navigation/ChatStackNavigator.tsx`, params `{ conversationId }`), whose reply keeps running on leave; and `RecipeChatScreen`, which calls `abortStream` in its own cleanup, so its replies never finish after leave. The Coach Pro surfaces (`client/components/coach/CoachChat.tsx`, `client/components/CoachOverlayContent.tsx`) use a different hook, `useCoachStream`, and are out of scope. Confirm with LSP `findReferences` before relying on this.
- The toast needs the conversation title or a generic label, plus the target route. Check `ChatStackNavigator.tsx` for the Coach chat route name and params.
- Clear the mark where the conversation screen mounts or focuses for that `conversationId`.

## Scope Contract

- **Files in scope:** `client/hooks/useChat.ts` + `client/hooks/__tests__/useChat.test.ts`, `client/navigation/MainTabNavigator.tsx` + its test (composing with the existing reminders dot; `client/hooks/usePendingReminders.ts` only if the composition needs it), `client/screens/ChatScreen.tsx` + its test (clearing the mark), a small new store module under `client/lib/` or `client/hooks/` for the unread marks + its test, and the toast bridge wiring if it needs a new emit call.
- No server changes.

## Dependencies

- #1183 (keep-running on unmount) merged first.
- #1184 merged first: it adds the `{ pop: true }` / StackRouter section to the bare-navigate solution doc that AC2 cites.

## Risks

- `tabBarBadge` renders a number by default. A dot may need `tabBarBadge: ""` plus `tabBarBadgeStyle`, or a custom icon overlay. Check how the dot looks on iOS and Android.

## Updates

### 2026-09-29

- Filed from the user's request during the P3 `/todo` run; design chosen by the user (toast + dot).
