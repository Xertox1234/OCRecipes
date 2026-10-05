---
title: "Coach Chat: navigating to a different conversationId re-points the current Chat instance (no getId on the Chat screen; the nested pop never reaches the Coach stack) — the Coach-replied toast's Open can show the other chat's draft and in-flight reply"
status: done
priority: low
created: 2026-10-02
updated: 2026-10-02
assignee:
labels: [deferred, react-native, client-state]
github_issue:
---

# Coach Chat navigate re-points the current conversation

## Summary

`openCoachConversation` (`client/navigation/MainTabNavigator.tsx:96-105`) and the AllConversations coach row (`client/screens/AllConversationsScreen.tsx:164-175`) navigate `Main → CoachTab → Chat` with `{ pop: true }` only in the OUTER options. The `Chat` screen has no `getId`, so when a Chat is already the Coach stack's current route, a navigate to `Chat` with a DIFFERENT `conversationId` re-points that same instance (same route key, params replaced) and ChatScreen's hook state — the composer draft and the in-flight stream — carries over to the other conversation. Give `Chat` a `getId` keyed on `conversationId`, forward `pop` inside the nested params, and prove both against the real `StackRouter`.

## Background

- Noticed during the `/todo` sweep PR #1216 (Coach reply toast + unread dot), verified 2026-10-02 against main `ec26b972` and upheld by an adversarial re-check. Deferred because the router behaviour was outside #1216's scope (that PR added the toast, the new producer) and the visible wrong state needs a two-conversation race.
- Both mechanism halves are confirmed in the installed library source (`@react-navigation/core` 7.13.5, `@react-navigation/routers` 7.5.2):
  1. A navigator builds the action for its nested params as `CommonActions.navigate({ name: route.params.screen, params: route.params.params, …, pop: route.params.pop })` (`node_modules/@react-navigation/core/src/useNavigationBuilder.tsx:649-655`). Only a `pop` placed INSIDE the nested params is forwarded; the outer `{ pop: true }` applies to the root stack alone (which is what it was added for — see `docs/solutions/logic-errors/bare-navigate-cannot-descend-into-an-unrelated-nested-navigator-2026-09-29.md`). The Coach `StackRouter` receives `pop: undefined`.
  2. With no `getId`, `StackRouter`'s NAVIGATE reuses the CURRENT route whenever the names match (`node_modules/@react-navigation/routers/src/StackRouter.tsx:375-376`) and replaces its params through `createParamsFromAction` (`StackRouter.tsx:405`; `merge` is unset, so the old params are discarded — `node_modules/@react-navigation/routers/src/createParamsFromAction.tsx:13-22`). `grep -rn getId client/navigation/` finds nothing, so this applies to `Chat`.
- What a user can see today: Chat(X) is streaming a reply → Back to ChatList → open Chat(Y), start typing → X's reply finishes → `noteCoachReplyFinished` sees viewed = Y ≠ X (`client/hooks/useCoachUnreadReplies.ts:149-155`) → toast "Coach replied — tap to open" → Open → the Coach `StackRouter` re-points the current Chat(Y) to `{ conversationId: X }`. ChatScreen resets nothing on an id change: `inputText` (`client/screens/ChatScreen.tsx:328`) survives, and `useSendMessage` is one single-slot stream per hook instance (`client/hooks/useChat.ts:395-401` — `if (isStreamingRef.current) return;` also silently drops a message typed into the re-pointed X while Y's reply is still streaming). The hook's only effect is the unmount epoch bump (`useChat.ts:382-386`); ChatScreen's effects at 345/356/372/381 handle errors, scroll and `initialMessage` only. This is **visible only with two coach conversations in flight inside the toast window** — 5 s, 10 s with a screen reader (`client/components/Toast.tsx:50,52`) — hence low severity.
- #1216 deliberately handled the re-point for the focus marker (`useCoachUnreadReplies.ts:96-98`: the leave function only clears the marker while it is still that conversation's), so the unread dot is right; the defect is the un-reset draft/stream state.
- Not #1216-specific: the pre-existing `chat/:conversationId` deep link (`client/navigation/linking.ts:214-219`) re-points the same way when a Chat is current. In-app producers: the toast's Open (`navigationRef.navigate(` has exactly one call site, `MainTabNavigator.tsx:98`), and `AllConversationsScreen`'s free-tier branch, which opens the plain Chat screen when `showCoachPro` is false (`client/screens/AllConversationsScreen.tsx:160-173`). AllConversations opens from CoachPro (`client/screens/CoachProScreen.tsx:359`) and also from the root `conversation-list` deep link (`client/navigation/linking.ts:254`). Its premium branch hands the id to CoachPro's `selectedConversationId`, which re-points CoachPro by design.
- The `pop` half is latent: nothing can sit above `Chat` today. ChatScreen's only navigation calls are `setParams` (`ChatScreen.tsx:424`) and `popTo("ChatList")` (`ChatScreen.tsx:503`), `client/components/ChatBubble.tsx` has none, and the Coach library links (`client/components/coach/CoachChat.tsx:639-653`) are hosted only by CoachProScreen. It goes live the moment `getId` lands (two Chats can then be stacked), so fix both halves together.

## Acceptance Criteria

- [ ] `client/navigation/chatRouteId.ts` (new) exports a pure `getChatRouteId({ params })` that returns `String(params.conversationId)` when `params` carries a `conversationId` and `undefined` otherwise (the `{ initialMessage }` and `undefined` new-chat shapes of `ChatStackParamList.Chat`, `client/navigation/ChatStackNavigator.tsx:51`), and the `Chat` screen (`ChatStackNavigator.tsx:119-123`) passes it as `getId`.
- [ ] `client/navigation/__tests__/ChatStackNavigator.test.tsx`: the `Screen` double (55-58, records `name` only today) also records `getId`, and a test asserts `Chat`'s `getId` is `getChatRouteId` (`toBe`) and that no other registered screen has one; the existing `initialRouteName` assertions still pass.
- [ ] `client/navigation/MainTabNavigator.tsx` `openCoachConversation` carries `pop: true` INSIDE the CoachTab params, as a sibling of `screen: "Chat"` (line 102), keeping the outer `{ pop: true }` (104) for the root stack; the exact-args assertion in `client/navigation/__tests__/MainTabNavigator.test.tsx:352-378` is updated to the new payload and still rejects the bare `navigate("Chat", …)` form.
- [ ] `client/screens/AllConversationsScreen.tsx` Chat branch (173) carries `pop: true` in the same position; the exact-args assertion in `client/screens/__tests__/AllConversationsScreen.test.tsx:165-172` is updated; the two CoachPro-branch assertions (141-148, 186-196) are unchanged, because that branch hands the id to CoachPro's `selectedConversationId`, whose re-point is by design (CoachPro is not necessarily current: the `conversation-list` deep link can open AllConversations from anywhere; that case is out of scope here).
- [ ] `MainTabNavigator.test.tsx` gains an "against the real Coach StackRouter" block beside the root block (384-459) that derives the nested action FROM THE TAPPED ARGS the way `useNavigationBuilder.tsx:649-655` does (`name = params.params.screen`, `params = params.params.params`, `pop = params.params.pop`) and runs it through `StackRouter({})` with `routeGetIdList: { Chat: getChatRouteId }`:
  - different conversation: `[ChatList, Chat(7)]` → `[ChatList, Chat(7), Chat(5)]`, with Chat(7)'s key and params untouched;
  - positive control with `routeGetIdList: {}`: the same action gives `[ChatList, Chat]` with Chat's key UNCHANGED and params now `{ conversationId: 5 }` — the re-point this todo fixes (this control is the denominator; without it a green test proves nothing);
  - same conversation: `[ChatList, Chat(5)]` → `[ChatList, Chat(5)]`, same key (no duplicate);
  - pop forwarded: `[ChatList, Chat(5), GroceryLists]` → `[ChatList, Chat(5)]`; control with the nested `pop` stripped → `[ChatList, GroceryLists, Chat(5)]` (the route is moved to the top instead of popped back to).
- [ ] Simulator check — **not a merge gate**; the owner runs it in a session with them present (owner request 2026-10-02). This todo's PR is low priority and client-only, so it can auto-merge on green CI; the router-level tests above are the merge gate. An unattended executor leaves this box unchecked and says so in the PR body. Setup (needs `npm run server:dev` with an AI key and a **free-tier** login — demo/demo123 is premium and lands on CoachPro, whose chat never raises this toast, because only `client/screens/ChatScreen.tsx:304` opts in with `notifyWhenAway`; register a fresh account, which defaults to free): send a message in coach chat A, Back, open coach chat B and type a draft, wait for A's "Coach replied" toast, tap Open — A opens with an empty composer and A's own messages, and Back returns to B with its draft intact.

## Implementation Notes

- **Why a separate pure module instead of an inline `getId`:** `MainTabNavigator.test.tsx:91` mocks `@/navigation/ChatStackNavigator` to `{ default: () => null }`, and `vi.importActual` of that module would pull every hosted screen's hook/context tree into the node environment (it imports ChatScreen, CoachProScreen, the meal-plan screens, …). `client/navigation/coachInitialRoute.ts` is the same-directory precedent (a pure function extracted so the navigator decision is unit-testable without rendering the navigator); follow its header-comment style and, like it, do not import the navigator module for the type — type the argument structurally. Sketch:

  ```ts
  // client/navigation/chatRouteId.ts (new)
  /** `getId` for the Coach stack's Chat screen: one route instance per conversation. */
  export function getChatRouteId({
    params,
  }: {
    params?: object;
  }): string | undefined {
    return params !== undefined && "conversationId" in params
      ? String(params.conversationId)
      : undefined;
  }
  ```

  `"conversationId" in params` narrows `object` to `object & Record<"conversationId", unknown>`, so no cast is needed; the screen prop type is `getId?: ({ params }: { params: Readonly<ParamList[RouteName]> }) => string | undefined` (`node_modules/@react-navigation/core/src/types.tsx:717-721`), and the router's `routeGetIdList` entry (used by the router test below) is `(options: { params?: Record<string, any> }) => string | undefined` (`node_modules/@react-navigation/routers/src/types.tsx:139-143`). Declaring `params` optional (`params?: object`) satisfies both; a required `params: object | undefined` type-checks as the screen prop but fails `tsc` in the router position (TS2322, measured 2026-10-02). Wire it at `ChatStackNavigator.tsx:119-123`: `<Stack.Screen name="Chat" component={ChatScreen} getId={getChatRouteId} options={{ headerTitle: "NutriCoach" }} />`.

- **The new-chat flow is safe with `getId`:** `getId` is evaluated against each route's CURRENT params at navigate time (`StackRouter.tsx:360-370`: `getId?.({ params: action.payload.params })` for the target, `getId?.({ params: route.params })` for each existing route in `findLast`), so the fresh instance that starts with no id and receives one from `navigation.setParams({ conversationId: conversation.id })` (`ChatScreen.tsx:424`) is found by that id from then on; a later Open for the same id reuses it rather than pushing a duplicate. A malformed deep-link id (0, see `ChatScreen.tsx:290-297`) gets the id `"0"`, which is fine.
- **Where the nested `pop` goes:** at the CoachTab-params level, a sibling of `screen: "Chat"`, because `useNavigationBuilder.tsx:654` reads `route.params.pop` off the CoachTab route when it builds the Coach stack's action. `NavigatorScreenParams` types it (`node_modules/@react-navigation/core/src/types.tsx:1020,1029`), so no cast:

  ```ts
  // MainTabNavigator.tsx:98-105
  navigationRef.navigate(
    "Main",
    {
      screen: "CoachTab",
      params: { screen: "Chat", params: { conversationId }, pop: true },
    },
    { pop: true }, // root stack: return to the EXISTING Main (unchanged)
  );
  ```

  Same shape at `AllConversationsScreen.tsx:173` (`: { screen: "Chat", params: { conversationId: conv.id }, pop: true }`). Extend the comment at `MainTabNavigator.tsx:87-95` with one sentence: the outer `pop` stops at the root stack; the nested one is what the Coach stack sees.

- **Semantics after the fix:** with `getId` the router finds an existing Chat(X) anywhere in the stack (`StackRouter.tsx:365-370`). With the nested `pop: true` it pops back to it, discarding everything above (`StackRouter.tsx:411-427`); without `pop` it would MOVE the route to the top, keeping the routes above beneath it (`StackRouter.tsx:431-438`). For the toast's Open this means: Chat(X) buried under Chat(Y) → Open(X) pops Y off. Y's draft goes with it, but Y stays reachable from ChatList and its in-flight reply keeps running (its done handler refreshes the conversation and still raises Y's toast/dot — the #1183 ruling, `useChat.ts:375-386`). If the owner would rather keep Y mounted beneath X, drop the nested `pop` and invert the pop criterion; that is a product preference, not something to decide at filing time.
- **Router test shape** (same recipe as the root block, `MainTabNavigator.test.tsx:384-459`, which the bare-navigate solution doc prescribes): build the Coach stack state with the real reducer — `const opts = { routeNames: ["ChatList", "Chat", "CoachPro", "GroceryLists"], routeParamList: {}, routeGetIdList: { Chat: getChatRouteId } }`, `router.getInitialState(opts)` then `router.getStateForAction(state, CommonActions.navigate("Chat", { conversationId: 7 }), opts)` to push Chat(7) (narrow on `stale !== false` exactly as `rootState` does at 408-424; `routeNames` must include every name the test navigates to or the router returns `null`, `StackRouter.tsx:356-358`). Take the nested payload from `tappedArgs()` (394-406): `const nested = params.params as { screen: string; params: object; pop?: boolean }` and dispatch `CommonActions.navigate({ name: nested.screen, params: nested.params, pop: nested.pop })` — the object form, as `useNavigationBuilder` uses it. Assert on `names(next)` plus `next.routes[i].key`/`.params` for the "untouched" and "same key" claims. The positive control passes `{ ...opts, routeGetIdList: {} }` with the same action.
- **Alternative (implementer's choice, from the adversarial re-check):** an in-place reset on `conversationId` change instead of `getId`. It would have to reset `inputText` (`ChatScreen.tsx:328`) and detach `useSendMessage`'s single-slot stream from the re-pointed screen (`useChat.ts:382-386` bumps the epoch on unmount only; `isStreamingRef`/`xhrRef` at 395-401 are per hook instance) while the old conversation's XHR keeps running and its done handler still calls `noteCoachReplyFinished` for the OLD id. That is strictly harder than `getId`, which gives every conversation its own ChatScreen + hook instance — the state model a Chat beneath ChatList already has today. Prefer `getId`; take the reset only with a concrete reason, and then the extra files listed in the Scope Contract are in scope.
- Deep link side-effect (no extra test required): with `getId`, `ocrecipes://chat/<id>` while another Chat is current pushes that conversation instead of re-pointing, and the same id reuses the instance.

## Scope Contract

- **Mechanisms to use:** React Navigation's `getId` screen prop and the `pop` field of nested `NavigatorScreenParams` (both already in the installed `@react-navigation/core` 7.13.5 types); the pure-module-for-testability precedent `client/navigation/coachInitialRoute.ts`; the existing real-`StackRouter` reducer test recipe in `client/navigation/__tests__/MainTabNavigator.test.tsx:384-459`. Nothing new in the app.
- **Files in scope:** `client/navigation/chatRouteId.ts` (new), `client/navigation/ChatStackNavigator.tsx`, `client/navigation/MainTabNavigator.tsx`, `client/screens/AllConversationsScreen.tsx`, `client/navigation/__tests__/MainTabNavigator.test.tsx`, `client/navigation/__tests__/ChatStackNavigator.test.tsx`, `client/screens/__tests__/AllConversationsScreen.test.tsx`. Only if the in-place-reset alternative is taken instead of `getId`: `client/screens/ChatScreen.tsx`, `client/hooks/useChat.ts`, `client/screens/__tests__/ChatScreen.test.tsx`, `client/hooks/__tests__/useChat.test.ts`.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None. #1216 is merged (the toast producer is in place).
- The cited library line numbers are for `@react-navigation/core` 7.13.5 and `@react-navigation/routers` 7.5.2 as installed at `ec26b972`; re-read them after any navigation bump.

## Risks

- The simulator criterion is owner-run and may happen after merge (see that criterion). If it shows a problem the router tests missed, fix forward with a new PR.
- `getId` changes the Back target: from a Chat(X) pushed above Chat(Y), Back lands on Chat(Y), not ChatList. Standard stack behaviour and arguably what the user expects (they were on Y), but it is a visible change.
- The nested `pop` decides whether the other Chat survives an Open tap (popped off vs kept beneath) — latent today, live once `getId` lands; see Semantics in the notes.
- Two mounted ChatScreens mean two `useSendMessage` instances and two streams. By construction they are different conversations (`getId` dedups the same id), which is the model the #1183 ruling already relies on.
- The `ChatStackNavigator.test.tsx` `Screen` double is also the guard for `initialRouteName` pointing at a registered screen; extending it to record `getId` must keep that assertion intact.
- A `routeNames` list in the router test that omits a name the test navigates to makes `getStateForAction` return `null` — a silent false red; narrow on `stale !== false` like the root block does.

## Updates

### 2026-10-02

- Filed from the 2026-10-02 deferred-warnings triage of the /todo sweep (#1213–#1226); claim verified against main ec26b972 by workflow wf_7d969d8d-ce1 and upheld by an adversarial re-check; filing approved by the owner 2026-10-02.

### 2026-10-04

- Implemented: getChatRouteId (client/navigation/chatRouteId.ts) wired as Chat getId; nested pop: true added in openCoachConversation and the AllConversations Chat branch; router-level tests with no-getId and stripped-pop controls. Simulator check left unchecked for the owner (not a merge gate).
