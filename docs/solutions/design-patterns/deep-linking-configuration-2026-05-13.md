---
title: Deep linking configuration with parseIntOrZero boundary validation
track: knowledge
category: design-patterns
module: client
tags: [react-native, navigation, deep-linking, validation, notifications, expo-notifications]
applies_to: [client/navigation/linking.ts, client/navigation/__tests__/**, client/screens/ChatScreen.tsx]
created: '2026-05-13'
last_updated: '2026-09-25'
---

# Deep linking configuration with parseIntOrZero boundary validation

## When this applies

Deep linking is configured in `client/navigation/linking.ts` and wired into `NavigationContainer` via the `linking` prop in `App.tsx`. The config maps URL paths to screens through the nested navigator hierarchy.

## Examples

### Supported URLs

| URL pattern                        | Screen               | Stack path                                               |
| ---------------------------------- | -------------------- | -------------------------------------------------------- |
| `ocrecipes://recipe/:recipeId`     | FeaturedRecipeDetail | Root modal (uses community endpoint, works for any user) |
| `ocrecipes://chat/:conversationId` | Chat                 | Main → CoachTab → Chat                                   |
| `ocrecipes://nutrition/:barcode`   | NutritionDetail      | Root modal                                               |
| `ocrecipes://scan`                 | Scan                 | Root modal                                               |

Universal link prefix `https://ocrecipes.app` is also registered (requires server-side AASA file for iOS).

### Adding a new deep link path

1. Add the screen's path mapping to `linking.config.screens` in `client/navigation/linking.ts`, nesting it to match the navigator hierarchy
2. If the param is numeric, use `parseIntOrZero` for the parse function
3. Add a test case in `client/navigation/__tests__/linking.test.ts`

### Boundary validation for URL params

Deep links are untrusted external input. Always use `parseIntOrZero` (not raw `parseInt`) for numeric params — it returns `0` instead of `NaN` for non-numeric strings, which the screen's existing error/not-found UI handles gracefully. `parseIntOrZero` does **not** clamp negatives (`-5` parses to `-5`), so a screen's "malformed" check must be "not a positive integer" (`!(id > 0)`), not `=== 0`.

The receiving screen's not-found guard must not live ONLY in the render branch. `linking.ts`'s `Scan`/`verifyBarcode` comment (`client/navigation/linking.ts`) is this repo's own example of an unparsed query param landing in `route.params` unfiltered — the same is true for any path that doesn't declare a `parse` entry for it, so a malformed positional id (`chat/abc` → `0`) and an arbitrary query param (`?initialMessage=hi`) can arrive on the SAME route object. If the screen also has a mount/param-driven effect that can invoke a create/send handler from that query param (a cross-tab auto-send-on-open, for example), the malformed-id guard must be duplicated inside that handler too — the not-found view rendering is not evidence that the handler was ever prevented from firing. See `docs/rules/react-native.md`'s deep-link bullet and `client/screens/ChatScreen.tsx` (M16, 2026-09-23 front-end audit).

A deep-link target's not-found view also needs its **own exit**. `linking.ts` declares no intermediate screens for `chat/:conversationId`, so the Coach stack holds only `Chat` and the header shows no back button. Two tempting exits are wrong (both read against the installed `@react-navigation` 7.x source):
- `canGoBack() ? goBack() : …` — `canGoBack()` is NOT local. It falls back to the parent's (`useNavigationHelpers.js`: `… || parentNavigationHelpers?.canGoBack()`), and the tab navigator's default `backBehavior: 'firstRoute'` puts Home in its history, so it returns true and `goBack()` lands on the Home tab.
- `navigate("ChatList")` — in v7 `StackRouter` only reuses the CURRENT route unless `pop: true`; otherwise it pushes, leaving the dead-end screen behind the list.

Use `navigation.popTo("ChatList")`: it pops back to an existing `ChatList`, or replaces the current screen with one when none exists. `NotebookEntryScreen` gets away with `goBack` because it is a root `fullScreenModal`. Do not escape via `setParams({ conversationId: undefined })`: the key stays present, so the malformed-id check stays true.

```typescript
// client/navigation/linking.ts
function parseIntOrZero(value: string): number {
  const num = parseInt(value, 10);
  return Number.isNaN(num) ? 0 : num;
}

// Usage in config
FeaturedRecipeDetail: {
  path: "recipe/:recipeId",
  parse: { recipeId: parseIntOrZero },
},
```

## Why

A raw `parseInt` returns `NaN` for non-numeric input. `NaN` propagates downstream (e.g., into a query `?recipeId=NaN`) and produces brittle error states. `0` is a sentinel the screens already handle as "not found," so deep-link garbage degrades into the existing not-found UI rather than crashing.

## Resuming unauthenticated deep links after login

When a deep link arrives while the user is not authenticated, the navigator's screen list typically contains only the auth/onboarding routes (e.g., `SignIn`, `Registration`). The deep link's intended target screen (e.g., `FeaturedRecipeDetail`) isn't in the navigator, so React Navigation silently discards it—the user never sees the desired content after logging in.

React Navigation v7 provides the prop `UNSTABLE_routeNamesChangeBehavior` on `Stack.Navigator` (available in `@react-navigation/native-stack` 7.x). Setting it to `'lastUnhandled'` causes the navigator to **automatically retry the most recent unhandled deep link** whenever the set of route names changes (i.e., when `isAuthenticated` flips to `true` and the full screen list mounts). This eliminates the need for a custom pending-link queue or manual state tracking.

### How to use

Add the prop to the root `Stack.Navigator` alongside `screenOptions`:

```typescript
import { createNativeStackNavigator } from '@react-navigation/native-stack';

const Stack = createNativeStackNavigator();

function RootNavigator() {
  const isAuthenticated = useIsAuthenticated(); // your auth hook

  return (
    <Stack.Navigator
      screenOptions={{ headerShown: false }}
      UNSTABLE_routeNamesChangeBehavior="lastUnhandled"
    >
      {isAuthenticated ? (
        <>
          <Stack.Screen name="FeaturedRecipeDetail" component={FeaturedRecipeDetail} />
          <Stack.Screen name="Chat" component={Chat} />
          <Stack.Screen name="NutritionDetail" component={NutritionDetail} />
          <Stack.Screen name="Scan" component={Scan} />
        </>
      ) : (
        <>
          <Stack.Screen name="SignIn" component={SignIn} />
          <Stack.Screen name="Registration" component={Registration} />
        </>
      )}
    </Stack.Navigator>
  );
}
```

### Behavior details

- The prop only activates when `doesStateHaveOnlyInvalidRoutes()` returns `true` (i.e., every screen in the current state is absent from the new set of route names).
- Normal authentication transitions (sign‑in, sign‑out) that do not have a pending deep link proceed exactly as before; the prop has no effect when all routes are valid.
- Only the **last** unhandled link is retried. If the user receives multiple deep links while unauthenticated, only the most recent one will be replayed.

### Risk

The `UNSTABLE_` prefix means the API may change or be removed across minor versions without prior notice. No stable alternative for this specific “handle deep link after route set changes” pattern currently exists. Monitor React Navigation changelogs for deprecation warnings or a renamed stable counterpart.

## Integrating expo-notifications via getInitialURL/subscribe

React Navigation 7's documented mechanism for routing a notification tap through the same `linking` config that handles ordinary deep links is to override `getInitialURL`/`subscribe` on the `LinkingOptions` object:

```typescript
// Vanilla React Navigation example — NOT this repo's linking.ts verbatim.
// The real file wraps extractNotificationUrl in consumeNotificationUrl (to
// call clearLastNotificationResponse) and adds an isReady()/pending-hold
// step before delivering to `listener`; see the two additions below.
async getInitialURL() {
  // A real deep link wins if both are somehow present — the more specific intent.
  const url = await Linking.getInitialURL();
  if (url != null) return url;

  const response = Notifications.getLastNotificationResponse();
  return extractNotificationUrl(response?.notification.request.content.data);
},
subscribe(listener) {
  const onReceiveURL = ({ url }: { url: string }) => listener(url);
  const linkingSubscription = Linking.addEventListener("url", onReceiveURL);

  const notificationSubscription =
    Notifications.addNotificationResponseReceivedListener((response) => {
      const url = extractNotificationUrl(response.notification.request.content.data);
      if (url) listener(url);
    });

  return () => {
    linkingSubscription.remove();
    notificationSubscription.remove();
  };
},
```

Use `Notifications.getLastNotificationResponse()` (synchronous), not `getLastNotificationResponseAsync()` — the installed `expo-notifications` SDK marks the `Async` form `@deprecated` in favor of the sync one. `getInitialURL` is already an `async` function, so calling the sync API inside it needs no `await`.

Notification payloads must carry a **full-prefixed** URL (e.g. `ocrecipes://notebook-entry/42`), never a bare path or id — `extractPathFromURL` (internal to React Navigation, used to match a URL against `prefixes`) returns `undefined` for a string matching none of them, silently dropping the link. When a payload only carries a bare id field (a legacy shape, or a third-party/server-scheduled sender that predates this pattern), reconstruct the full-prefix URL from it rather than passing the id through as-is — see `client/navigation/linking.ts`'s `extractNotificationUrl` for a worked example, and note in the code that this fallback is not always a temporary migration bridge: a sender you don't control (e.g. a server-driven push path) may keep emitting the legacy shape indefinitely, so the fallback should be treated as permanent unless every sender is confirmed updated.

`getInitialURL` and a live `subscribe` tap can both fire for the *same* cold-launch notification — `expo-notifications` delivers the launch response via `getLastNotificationResponse()` and may also emit it to a freshly-registered `addNotificationResponseReceivedListener`. This is benign: the second delivery is a same-route re-navigate (a no-op), so no deduplication is needed — verified by reading source, not on a device.

**Clear the response once it has been turned into a URL** (`Notifications.clearLastNotificationResponse()`, in both `getInitialURL` and the `subscribe` listener). The last response is an in-memory field that lives for the whole app process (`EmitterModule.swift` / `NotificationsEmitter.kt`), and `getInitialURL` runs again on every `NavigationContainer` mount. In this app `ErrorBoundary` wraps the container, so its "Try Again" remounts it and, uncleared, re-opens the last tapped entry, which may be the screen that crashed. Also accept only a positive-integer `entryId` when building the fallback URL (`notebook-entry/0` opens an entry that can't save).

### The gap the vanilla example doesn't close: a live tap before the navigator has mounted

Verified by reading the installed `@react-navigation/native`/`@react-navigation/core` source (`node_modules`), not assumed from docs. The vanilla `getInitialURL`/`subscribe` pattern above, by itself, does **not** handle a notification tap that arrives while the app is already running but the root navigator hasn't mounted yet (e.g. a screen showing a loading spinner instead of a `Stack.Navigator`, gated on an auth check):

- `useLinking.native.js`'s `subscribe`-path listener (`node_modules/@react-navigation/native/lib/module/useLinking.native.js` ~lines 118-143) resolves the URL to a state and calls `navigation.dispatch(action)` or `navigation.resetRoot(state)` on the ref `NavigationContainer` exposes.
- `BaseNavigationContainer.js`'s `dispatch` (~lines 106-112) and `resetRoot` (~lines 127-137) both branch on `listeners.focus[0] != null` — the same condition `navigationRef.isReady()` exposes — and **silently `console.error(NOT_INITIALIZED_ERROR)` with no retry and no queueing** when it's `false` (no child `Stack.Navigator` has registered a focus listener yet).
- This is different from the `UNSTABLE_routeNamesChangeBehavior="lastUnhandled"` replay above (which is triggered through `getInitialURL`'s cold-launch initial-state path, entirely independent of `navigationRef`/`isReady()`) — a *live* `subscribe` tap during this window is a genuine, unrecoverable drop with the vanilla pattern.
- The window is real but normally **boot-only**: it exists only until the app's first auth check resolves (in this project, `client/hooks/useAuth.ts`'s `isLoading` starts `true` exactly once and a foreground-resume recheck never sets it back to `true`), so it is not a recurring "warm, backgrounded" condition once the app has booted once.

**The fix**: hold the URL in a module-level variable when `navigationRef.isReady()` is `false`, and flush it via `NavigationContainer`'s own `onReady` prop instead of delivering it straight to the `subscribe` listener. `createNavigationContainerRef`'s `isReady()` safely returns `false` (never throws) when the ref isn't attached yet, and `onReady` fires exactly once, precisely when `isReady()` first flips `true` (`BaseNavigationContainer.js`'s `onReadyCalledRef` effect) — so the hold-then-flush ordering is sound, not racy. This uses only `NavigationContainer`'s existing, documented `onReady` prop plus `navigationRef.isReady()` — no new library, dependency, or architectural layer:

```typescript
// client/navigation/linking.ts
let pendingNotificationUrl: string | undefined;
let deliverUrl: ((url: string) => void) | undefined;

export function flushPendingNotificationUrl(): void {
  if (pendingNotificationUrl && deliverUrl) {
    const url = pendingNotificationUrl;
    pendingNotificationUrl = undefined;
    deliverUrl(url);
  }
}

// inside subscribe(listener): deliverUrl = listener; then, in the
// notification callback, `navigationRef.isReady() ? listener(url) : (pendingNotificationUrl = url)`

// client/App.tsx
<NavigationContainer ref={navigationRef} linking={linking} onReady={flushPendingNotificationUrl}>
```

A unit test that calls the exported `getInitialURL`/`subscribe` functions directly (see Testing below) can only assert URL **forwarding** into React Navigation's own `listener` — it cannot observe React Navigation's own replay behavior (the `UNSTABLE_routeNamesChangeBehavior="lastUnhandled"` mechanism, or this hold/flush). Verify those by reading the installed source as above, and say explicitly in the test's comments and in any PR description that on-device/simulator verification is a separate, unperformed step.

## Length cap before parse — one override covers every URL source

`query-string`/`decode-uri-component`'s query-param decoding is still O(entries × length) on many distinct malformed percent-runs even after the GHSA-vcc3-ghjq-m6fr fix (0.5.0) — a ~200 KB link with thousands of distinct runs can stall the JS thread for over a second. Add a single `getStateFromPath` override to the `linking` config that rejects any path+query over a length cap (e.g. 8 KB) before delegating to the real parser:

```typescript
// client/navigation/linking.ts
import { getStateFromPath as getStateFromPathDefault } from "@react-navigation/core";

const MAX_DEEP_LINK_PATH_LENGTH = 8 * 1024;

export const linking: LinkingOptions<RootStackParamList> = {
  prefixes: [...],
  getStateFromPath(path, options) {
    if (path.length > MAX_DEEP_LINK_PATH_LENGTH) return undefined;
    return getStateFromPathDefault(path, options);
  },
  // ...getInitialURL, subscribe, config as above
};
```

Import the default parser from `@react-navigation/core`, **not** `@react-navigation/native` — the same reason the test file avoids `native` (above): `native`'s index also re-exports `NavigationContainer`/`Link`/etc., whose module graph pulls in React Native sources the Vitest node env can't load. `core` is the identical function `native` re-exports unchanged (`@react-navigation/native/lib/module/index.js`: `export * from '@react-navigation/core'`), and is already a resolved transitive dependency.

**One override genuinely covers every URL source** — verified by reading `node_modules/@react-navigation/native/lib/module/useLinking.native.js` and `NavigationContainer.js`, not assumed from the option's name: `NavigationContainer.js` spreads the app's `linking` object (including this override) into the options object passed to `useLinking`, and `useLinking`'s single internal `getStateFromURL` callback calls `extractPathFromURL` then the (possibly overridden) `getStateFromPath` for **both** `getInitialState` (the async `getInitialURL` path — this repo's own `getInitialURL` already folds the notification's `data.url`/entryId-derived fallback into what it returns) and the `subscribe` listener (live `Linking` events, and the pending-hold `flushPendingNotificationUrl` replay above, since flushing calls `deliverUrl`, which the `subscribe` effect set to the exact same `listener`). The `UNSTABLE_routeNamesChangeBehavior="lastUnhandled"` replay (`RootStackNavigator.tsx`) is a separate concern: it rehydrates an already-computed navigation **state object**, never re-invoking `getStateFromPath` on the raw path a second time — so a link rejected by the cap cannot later be decoded uncapped through that path either.

Pick the cap by measuring the app's real longest link (the verify-email token, ~350-430 chars depending on email length here) rather than guessing — leave at least an order of magnitude of headroom. Test the cap boundary two-sided (`length === cap` still parses; `cap + 1` is rejected) in addition to a heavy adversarial payload, and fall back to the raw parser in that heavy-payload test (`linking.getStateFromPath ?? getStateFromPathDefault`) so a regression that removes the override fails on the timing assertion rather than a `TypeError` on a missing property.

## Testing

Test `getInitialURL`/`subscribe` by calling the exported functions directly — do not mount `NavigationContainer` (same avoidance `client/navigation/__tests__/linking.test.ts` already uses for `getStateFromPath`, importing from `@react-navigation/core` instead of `@react-navigation/native` to avoid pulling in React Native sources the node env can't load). Mocking gotchas:

- The globally-aliased `react-native` mock (`test/mocks/react-native.ts`) only exports `Linking.openURL`/`openSettings` — no `getInitialURL`/`addEventListener`. Override locally per `docs/solutions/conventions/inline-vi-mock-globally-aliased-modules-2026-05-13.md` item 3 ("missing exports"): `vi.mock("react-native", async (importOriginal) => ({ ...(await importOriginal()), Linking: { ...actual.Linking, getInitialURL: vi.fn(), addEventListener: vi.fn() } }))`.
- `expo-notifications` has no global alias; mock it inline per-file (`getLastNotificationResponse`, `clearLastNotificationResponse`, `addNotificationResponseReceivedListener`), matching `client/lib/__tests__/notifications.test.ts`'s existing shape.
- If the module under test imports `navigationRef` (for the `isReady()` gate above), mock `../navigationRef` too — its runtime import chain otherwise pulls in `@react-navigation/native`.

## Related Files

- `client/navigation/linking.ts` — `parseIntOrZero` + config; `getInitialURL`/`subscribe` + the pending-URL hold/flush
- `client/App.tsx` — `linking` prop on `NavigationContainer`; `onReady={flushPendingNotificationUrl}`
- `client/navigation/RootStackNavigator.tsx` — `UNSTABLE_routeNamesChangeBehavior` prop on root `Stack.Navigator`
- `client/navigation/navigationRef.ts` — the `isReady()` check the hold/flush depends on
- `client/hooks/useNotebookNotifications.ts` — schedules the `url` field the notification-tap path reads
- `client/navigation/__tests__/linking.test.ts`
- `client/screens/ChatScreen.tsx` — malformed-id guard duplicated inside `handleSend`, not just the render branch (M16, 2026-09-23 front-end audit)

## See Also

- [Deep link query param aliases](deep-link-query-param-aliases-2026-05-13.md)
