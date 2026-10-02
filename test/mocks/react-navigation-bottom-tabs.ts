// Inert stub for @react-navigation/bottom-tabs, registered as a resolve.alias in
// vitest.config.mts.
//
// The real package is externalized by Vitest and loaded by Node's native
// loader, so its `import "react-native"` bypasses the react-native alias and
// lands on the REAL entry, whose Flow `import typeof` syntax throws
// `SyntaxError: Unexpected token 'typeof'` before any test runs. Inlining it
// (test.server.deps.inline) gets past that but then fails at import on
// `Easing.in(...)` (TransitionSpecs.tsx) — the DOM-rendering react-native mock
// doesn't export `Easing`. A stub keeps the harness independent of whatever
// else this view-layer package needs at import time.
//
// Mirrors only what the client reads OUTSIDE the tab navigator itself — the
// height context (HistoryScreen) and its hook — as a constant 0, the same inert
// shape as the @react-navigation/elements mock's `useHeaderHeight`. There is
// deliberately no `createBottomTabNavigator`: a test that renders
// MainTabNavigator mocks this package itself (MainTabNavigator.test.tsx), and
// any test that needs a specific tab-bar height does the same with a local
// `vi.mock("@react-navigation/bottom-tabs", ...)`.
import React from "react";

export const BottomTabBarHeightContext = React.createContext<
  number | undefined
>(undefined);

export const useBottomTabBarHeight = () => 0;
