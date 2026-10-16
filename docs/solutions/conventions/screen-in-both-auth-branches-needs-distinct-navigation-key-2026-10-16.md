---
title: "A deep-linked screen both signed-in and signed-out users can reach must be registered in BOTH auth branches, each with its own navigationKey"
track: knowledge
category: conventions
module: client
tags: [react-native, navigation, deep-linking, auth]
applies_to: [client/navigation/RootStackNavigator.tsx, client/navigation/linking.ts]
created: 2026-10-16
---

# A deep-linked screen both signed-in and signed-out users can reach must be registered in BOTH auth branches, each with its own navigationKey

## Rule

`RootStackNavigator` mounts a different screen set per auth state (`!isAuthenticated ? … : needsOnboarding ? … : …`). A path in `linking.ts` resolves by route **name**, whichever branch is mounted, so it works only in a branch that registers that name. When a link must work both signed in and signed out:

1. Register the screen in **each** branch.
2. Give each registration a **different** `navigationKey` (`"signed-out"` / `"signed-in"`).
3. Let the screen pick its exits from `useAuthContext().isAuthenticated`. The signed-in stack has no `Login`. Close through `safeGoBack(navigation, () => navigation.reset({ index: 0, routes: [{ name: "Main" }] }))`, because a link that cold-starts the app leaves the screen alone in the stack.

## Why

- **Missing from a branch → the link silently does nothing.** `UNSTABLE_routeNamesChangeBehavior="lastUnhandled"` stores the unhandled NAVIGATE and replays it only when the route names change. That means it might replay much later, for example on sign-out. Dev shows "The action 'NAVIGATE' … was not handled"; production shows nothing. The change-email flow mails a verify link to a user who stays signed in, so tapping it did nothing (#55, 2026-10 QA sweep).
- **Same name in both branches with no key → a broken stack on an auth flip.** `StackRouter.getStateForRouteNamesChange` keeps every route whose name is still registered unless its key changed. A session that ends while the user is on that screen collapses to `[VerifyEmail]` alone, with no `Login` under it. Distinct `navigationKey`s make the router drop the route, so the new branch's first screen takes over.
- The key change also unmounts the screen on a flip, so effects inside it (here, a mount-once token POST) cannot re-run under the other auth state.

## Examples

```tsx
// client/navigation/RootStackNavigator.tsx
{!isAuthenticated ? (
  <>
    <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
    <Stack.Screen name="VerifyEmail" navigationKey="signed-out"
      component={VerifyEmailScreen} options={{ headerShown: false }} />
  </>
) : (
  <>
    <Stack.Screen name="Main" component={MainTabNavigator} options={{ headerShown: false }} />
    <Stack.Screen name="VerifyEmail" navigationKey="signed-in"
      component={VerifyEmailScreen} options={{ headerShown: false, presentation: "modal" }} />
  </>
)}
```

Test what each branch registers (`client/navigation/__tests__/RootStackNavigator.test.tsx`). Swap `createNativeStackNavigator` for a recorder that renders each `Stack.Screen` as a marker carrying its `name` and `navigationKey`. Read the navigator's own `import X from "@/screens/…"` lines and `vi.doMock` each one to a null component, then dynamically import the navigator. Several screens pull in expo's dev runtime, which jsdom can't load, and reading the import lines means a new screen needs no test edit. `linking.test.ts` can't tell the branches apart: it parses paths and never mounts a navigator.

## Exceptions

- `needsOnboarding` mounts only `Onboarding`. A link tapped there stays unhandled and replays into the main branch once onboarding finishes, which is acceptable for VerifyEmail, so it is not registered there.
- Replay (`lastUnhandled`) is router behaviour a unit test can't observe. Check it on the simulator with `xcrun simctl openurl <udid> "ocrecipes://<path>"` in each auth state.

## Related Files

- `client/navigation/RootStackNavigator.tsx` — both VerifyEmail registrations
- `client/navigation/__tests__/RootStackNavigator.test.tsx` — the per-branch recorder test
- `client/screens/VerifyEmailScreen.tsx` — `isAuthenticated`-driven exits
- `client/navigation/safeGoBack.ts` — the cold-start fallback
- `client/navigation/linking.ts` — `VerifyEmail: "verify-email"`

## See Also

- [A deep-link-reachable screen owns its tier routing](deep-link-reachable-screen-owns-its-tier-routing-2026-09-30.md) — the same "the link skips the entry point" idea for premium gates
- [Deep linking configuration](../design-patterns/deep-linking-configuration-2026-05-13.md) — `safeGoBack` and cold-start stacks
