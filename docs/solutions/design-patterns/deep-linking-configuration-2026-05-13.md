---
title: Deep linking configuration with parseIntOrZero boundary validation
track: knowledge
category: design-patterns
module: client
tags: [react-native, navigation, deep-linking, validation]
applies_to: [client/navigation/linking.ts, client/navigation/__tests__/**]
created: '2026-05-13'
last_updated: '2026-05-30'
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

Deep links are untrusted external input. Always use `parseIntOrZero` (not raw `parseInt`) for numeric params — it returns `0` instead of `NaN` for non-numeric strings, which the screen's existing error/not-found UI handles gracefully.

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

## Related Files

- `client/navigation/linking.ts` — `parseIntOrZero` + config
- `client/App.tsx` — `linking` prop on `NavigationContainer`
- `client/navigation/RootStackNavigator.tsx` — `UNSTABLE_routeNamesChangeBehavior` prop on root `Stack.Navigator`
- `client/navigation/__tests__/linking.test.ts`

## See Also

- [Deep link query param aliases](deep-link-query-param-aliases-2026-05-13.md)
