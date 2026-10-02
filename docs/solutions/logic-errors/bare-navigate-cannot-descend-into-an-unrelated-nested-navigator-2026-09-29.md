---
title: "A bare navigate(name) called from outside a screen's ancestor chain silently no-ops — it never descends into an unrelated nested navigator"
track: bug
category: logic-errors
tags: [react-native, navigation, react-navigation, cross-stack]
module: client
applies_to: [client/navigation/**/*.tsx, client/screens/**/*.tsx]
symptoms: ["Tapping a row/button that calls navigation.navigate(\"ScreenName\", params) does nothing — no crash, no navigation, sometimes a dev-only console warning", "The target screen is registered several navigator levels away from the caller (a sibling branch's descendant), not an ancestor of the caller", "The same file uses the correct navigate(\"Parent\", { screen: \"Target\", params }) nested form elsewhere for an equivalent cross-navigator jump, but this one call site uses the bare form"]
created: 2026-09-29
severity: high
---

# A bare `navigate(name)` called from outside a screen's ancestor chain silently no-ops

## Problem

React Navigation's `navigation.navigate(name, params)` only resolves by walking **outward**
toward the root: it tries the caller's own navigator first, then each ancestor in turn, stopping
at the first one whose own registered screen list contains `name`
(`docs/solutions/logic-errors/nested-route-name-shadows-a-root-route-and-silently-retargets-navigate-2026-09-17.md`
documents the same outward-only rule from its "wrong match found" angle). It never walks
**inward** into a navigator nested under a sibling branch — a call whose target sits behind a
tab/stack that isn't an ancestor of the calling screen has no route to it at all, bare form or
not, and the action is dropped.

Found in `client/screens/AllConversationsScreen.tsx:127`: a root-level `fullScreenModal` screen
(registered directly on `RootStackNavigator`) called `navigation.navigate("CoachPro", {
selectedConversationId })`. `"CoachPro"` is registered two levels down, inside
`Main → CoachTab → ChatStackNavigator` — a **descendant** of a sibling root screen (`Main`), not
an ancestor of `AllConversationsScreen`. The call predates this finding by ~4.5 months
(`571ae40b`/`3faa9586`, 2026-05-09) and was never caught: `#1096`'s wiring of
`useRefreshOnFocus` into `CoachProScreen` was tested by mocking `useNavigation()` entirely (as
every screen test in this app does), so no test exercises real React Navigation resolution, and
manual QA of this one row is easy to miss when the sibling "Recipes" tab's row (`navigate`ing to
a **root-level** screen, `RecipeChat`) works fine from the same handler.

## Symptoms

- A row/button press that should open a screen does nothing.
- The target screen's own tests, wiring, and types all look correct — the defect is entirely at
  the call site, not the destination.
- The broken call sits beside a correct one in the same file, doing what looks like the same
  kind of cross-navigator jump (compare `AllConversationsScreen.tsx`'s own `navigation.reset(...)`
  "no back stack" fallback, which correctly uses `{ screen: "CoachTab" }`, right next to the
  broken bare `navigate("CoachPro", ...)`).

## Root Cause

Three source facts (pin `@react-navigation/{core,native,routers,bottom-tabs}` versions when
citing — verified against `^7.x` in this repo's `package.json`):

1. `CommonActions.navigate(name, params)` never sets `action.target`
   (`node_modules/@react-navigation/routers/lib/module/CommonActions.js:8-33`).
2. Action bubbling (`node_modules/@react-navigation/core/lib/module/useOnAction.js:37-91`) tries
   the current navigator's own router, then bubbles to **ancestors only** via `onActionParent`.
   Bubbling to **children** only runs `if (typeof action.target === 'string' ||
   action.type === 'NAVIGATE_DEPRECATED' || navigationInChildEnabled)` — none apply to a bare
   `.navigate(name, params)` call, and `navigationInChildEnabled` defaults to `false`
   (`DeprecatedNavigationInChildContext.js`) and must be explicitly opted into via
   `NavigationContainer`'s `navigationInChildEnabled` prop (unset in this app —
   `client/App.tsx`'s `<NavigationContainer>` only passes `ref`/`linking`/`onReady`).
3. Each navigator's own router (`StackRouter`'s `NAVIGATE` case,
   `node_modules/@react-navigation/routers/lib/module/StackRouter.js:186-190`) requires
   `state.routeNames.includes(action.payload.name)` — its **own** direct screen list, never a
   descendant's.

So resolution is: try my own navigator, then walk up through ancestors trying each one's own
screen list, stop at the root. If the target was never on that outward path, the action is
unhandled — no error is thrown (`onUnhandledAction` typically just logs a dev warning).

## Solution

Use the documented nested form to descend past the navigator that *is* reachable outward:

```tsx
// Broken — "CoachPro" isn't reachable outward from a root-level screen.
navigation.navigate("CoachPro", { selectedConversationId: conv.id });

// Still wrong from a MODAL above Main — pushes a SECOND "Main" route on top.
navigation.navigate("Main", { screen: "CoachTab", params: { /* … */ } });

// Correct — "Main" is reachable (it's a RootStack screen), the nested {screen, params}
// payload descends the rest of the way, and `pop: true` returns to the EXISTING Main
// instead of pushing a new one.
navigation.navigate(
  "Main",
  { screen: "CoachTab", params: { screen: "CoachPro", params: { selectedConversationId: conv.id } } },
  { pop: true },
);
```

**Returning to an ancestor stack's existing route needs `pop: true` (or `popTo`, or `reset`).**
`StackRouter`'s NAVIGATE only reuses an existing route when a `getId` matches, the target is the
CURRENT route, or `pop` is set. Otherwise it pushes. Measured against `@react-navigation/routers`
7.5.2 with root state `[Main, AllConversations]` (index 1): the plain nested navigate gives
`[Main, AllConversations, Main]` (a second MainTabNavigator instance, and the original Main never
gets the params); `pop: true` gives `[Main]`, with the nested params delivered to the existing Main;
the control, navigating to the current route, reuses it with no push.

Don't borrow a precedent from a different router. `HomeScreen.tsx`'s
`navigation.navigate("MealPlanTab", { screen: "RecipeImport", … })` is a lateral tab switch from
inside the focused Main navigator. `TabRouter` finds the tab by name and never pushes a
duplicate, so it isn't evidence for the stack case. `AllConversationsScreen.tsx`'s close button
`navigation.reset({ routes: [{ name: "Main", params: { screen: "CoachTab" } }] })` is safe for
the stack case because `reset` replaces the stack wholesale.

## Prevention

- **A bare `navigate(name)` is only safe when `name` is reachable by walking OUTWARD from the
  caller** — an ancestor navigator's own screen, or the caller's own navigator's own screen.
  Anything else (a sibling branch's descendant) needs the nested `{ screen, params }` form, with
  one level of nesting per navigator boundary crossed.
- Before adding a bare cross-navigator `navigate()` call, trace the caller's navigator ancestry
  (which `<Stack.Navigator>`/`<Tab.Navigator>` directly renders this screen, and its own parent
  chain up to the root) and confirm the target name appears in that chain's own registered
  screens — not merely "somewhere in the app."
- **Type the navigation prop by where the screen is actually registered.** A
  `CompositeNavigationProp` (see
  [composite-navigation-prop-cross-stack](../design-patterns/composite-navigation-prop-cross-stack-2026-05-13.md))
  is only honest when the screen really is nested that deep. `AllConversationsNavigationProp`
  claimed RootStack → MainTab → ChatStack for a screen registered on the root stack, which is
  exactly what let the bare `navigate("CoachPro")` type-check. With the plain
  `NativeStackNavigationProp<RootStackParamList, "AllConversations">` (the fix), `tsc` rejects the
  bare call (measured: TS2345) and still accepts the nested form through `NavigatorScreenParams`.
  So `tsc` DOES catch this class of bug, but only when the prop type isn't lying.
- A mocked-navigation unit test cannot tell push-a-duplicate from return-to-existing either:
  both are one `navigate` call. Assert the exact arguments (including `{ pop: true }`), and prove
  the router behaviour once with a direct `StackRouter(...).getStateForAction(...)` call against
  the real `@react-navigation/routers`: that pure reducer loads fine under Node, unlike rendering
  the real navigators in jsdom.
- It is not caught by ESLint, or by a `vi.mock("@react-navigation/native", ...)` unit test
  (which replaces `useNavigation()`'s `navigate` with a plain spy, so it never exercises real
  resolution). Verifying reachability requires either reading the navigator tree by hand or an
  integration test against the real (unmocked) `@react-navigation/*` packages — attempted for this
  finding and abandoned: a from-scratch jsdom harness using the real packages hit an unrelated
  `@react-navigation/native` import/transform failure under this project's Vitest config
  (`SyntaxError: Unexpected token 'typeof'`, reproduced even importing `@react-navigation/native`
  alone with no other code) — this project has no existing precedent for rendering real (as
  opposed to mocked) React Navigation in a jsdom test, and none of the existing navigator test
  files (`ChatListScreen.test.tsx`, `MainTabNavigator.test.tsx`, etc.) attempt it.
- **Static guard (2026-10-01):** `scripts/__tests__/navigation-route-reachability.test.ts` reads
  the navigator files and each registered screen's own source, and requires every literal
  `navigate/push/replace("X")` to name a route registered in that screen's navigator or an
  ancestor. It checks each registration separately, so a screen registered in two navigators is
  checked in both. The unresolved set must equal a short `KNOWN_UNRESOLVED` list (a ratchet both
  ways). Scope limit: it scans the screen's own file only, not the child components or hooks it
  renders.

## Second instance: dual-registered root-modal copies (2026-10-01)

Since the Profile hub redesign (#34, 2026-04-02), the Profile library tiles opened ROOT-modal
copies of Plan-stack screens (`GroceryListsModal`, `CookbookListModal`, `PantryModal`,
`RecipeBrowserModal`). Inside those copies, every link to a Plan-stack-only route was dropped:
opening a grocery list, opening a cookbook, opening a list just created, and the Recipes "+".
Same mechanism as above. The screen file was correct for its first registration and silently
wrong for its second. The static guard found 7 such edges, all in those copies. The fix registers
the screens inside the Profile stack (`FavouriteRecipes` precedent) and rewrites the two links
that leave the library screens (`GroceryList` → Plan home, `RecipeBrowser` → Add Recipe) to the
root-qualified nested form, which resolves from every registration.

Two gotchas from that fix:

- `navigate("MealPlanTab", …)` resolves from inside a tab's stack, but NOT from a root modal,
  because the tab lives inside `Main`, a child of the root. `navigate("Main", { screen:
  "MealPlanTab", params: { … } }, { pop: true })` resolves from everywhere.
- Navigating into a tab stack that hasn't mounted yet makes the nested `screen` its ONLY
  route, with no back button to the stack's home. Pass `initial: false` in the nested params to
  keep the stack's initial route underneath. Measured on the simulator: without it, Profile →
  Recipes → "+ Add" opened Add Recipe with no way back to Plan home.

The same copies had a second, separate bug. A `useConfirmationModal` sheet opened from a screen
presented with `presentation: "modal"` rendered BEHIND the native modal, because the only
`BottomSheetModalProvider` is at `App.tsx`'s root. So "delete" did nothing visible. Moving the
Profile tiles into the Profile stack sidesteps it for Profile only. The Coach still opens the
root-modal copies (`CoachChat.tsx`), and they keep both bugs; those are the `KNOWN_UNRESOLVED`
edges.

## Related Files

- `client/screens/AllConversationsScreen.tsx` — the coach-row call site, fixed to the nested form (found as a deferred warning in `todos/archive/P3-2026-09-26-all-conversations-screen-no-refetch-when-mounted.md`)
- `client/types/navigation.ts` — `AllConversationsNavigationProp`, narrowed from a false 3-level composite to the root-stack prop so `tsc` rejects the bare call
- `client/screens/HomeScreen.tsx` — the correct nested-form pattern for an equivalent cross-tab jump
- `client/navigation/RootStackNavigator.tsx` — `AllConversations`'s registration (root-level) vs. `Main`'s
- `client/navigation/MainTabNavigator.tsx` — `CoachTab`'s registration (lazy by default)
- `client/navigation/ChatStackNavigator.tsx` — `CoachPro`'s registration, two levels below root
- `client/App.tsx` — `NavigationContainer`, confirming `navigationInChildEnabled` is unset
- `todos/archive/2026-05-09-all-conversations-route-param.md` — the todo that introduced the broken call

## See Also

- [A nested navigator that declares an existing route NAME silently re-targets every navigate()](nested-route-name-shadows-a-root-route-and-silently-retargets-navigate-2026-09-17.md) — the sibling bug on the same outward-walk mechanism: a WRONG match found outward, vs. this doc's NO match found outward
- [CompositeNavigationProp for cross-stack navigation](../design-patterns/composite-navigation-prop-cross-stack-2026-05-13.md) — the type-level tool that does not, by itself, guarantee runtime reachability
- [Align route params across dual-navigator screens](../conventions/align-route-params-dual-navigator-screens-2026-05-13.md)
