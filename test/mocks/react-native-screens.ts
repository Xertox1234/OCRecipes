// Mock react-native-screens for component render tests.
//
// The REAL package transitively imports react-native's Flow-syntax internals
// (react-native/index.js's `import typeof * as ReactNativePublicAPI from
// './index.js.flow'`), which neither Vitest's oxc transform nor its esbuild
// fallback can parse — this is the exact same problem class this project's
// test/mocks/react-native.ts and test/mocks/react-native-svg.ts already solve
// for their respective packages. A `vi.mock()` cannot fix this: Vitest's
// dependency-scan/pre-bundle phase walks the static import graph BEFORE any
// vi.mock() interception takes effect, so a `vitest.config.ts` resolve.alias
// is required. See docs/solutions/runtime-errors/
// mock-native-svg-flow-syntax-transform-failure-2026-07-12.md, which named
// this exact package as a predicted "latent next occurrence."
//
// Covers the named exports actually consumed by @react-navigation/native-stack
// and @react-navigation/bottom-tabs (verified against their compiled source
// under node_modules/@react-navigation/{native-stack,bottom-tabs}/lib/module/):
// ScreenStack, ScreenStackItem (NativeStackView), ScreenFooter
// (FooterComponent), the ScreenStackHeader* subview components + SearchBar +
// isSearchBarAvailableForCurrentPlatform (useHeaderConfigProps), and Screen /
// ScreenContainer / screensEnabled (ScreenFallback, used defensively behind a
// try/catch + optional-chaining check — screensEnabled() returning false here
// makes bottom-tabs fall back to plain Views, which is fine for jsdom tests).
//
// NOT covered: BottomTabs / BottomTabsScreen, imported by
// @react-navigation/bottom-tabs' `./unstable` subpath entry point (a separate
// export from its default `.` entry). Confirmed unreachable today — no file
// in this repo imports `@react-navigation/bottom-tabs/unstable`. If that ever
// changes, this mock will need those two exports added; it will otherwise fail
// at a different, silent render-time site rather than the transform-time
// crash this mock exists to fix.
import React from "react";

function screenEl(tag: string, displayName: string) {
  const Comp = React.forwardRef<unknown, Record<string, unknown>>(
    ({ children, ...rest }, ref) =>
      React.createElement(tag, { ref, ...rest }, children as React.ReactNode),
  );
  Comp.displayName = displayName;
  return Comp;
}

export const ScreenStack = screenEl("div", "ScreenStack");
export const ScreenStackItem = screenEl("div", "ScreenStackItem");
export const ScreenFooter = screenEl("div", "ScreenFooter");
export const ScreenContainer = screenEl("div", "ScreenContainer");
export const Screen = screenEl("div", "Screen");
export const SearchBar = screenEl("input", "SearchBar");
export const ScreenStackHeaderBackButtonImage = screenEl(
  "div",
  "ScreenStackHeaderBackButtonImage",
);
export const ScreenStackHeaderCenterView = screenEl(
  "div",
  "ScreenStackHeaderCenterView",
);
export const ScreenStackHeaderLeftView = screenEl(
  "div",
  "ScreenStackHeaderLeftView",
);
export const ScreenStackHeaderRightView = screenEl(
  "div",
  "ScreenStackHeaderRightView",
);
export const ScreenStackHeaderSearchBarView = screenEl(
  "div",
  "ScreenStackHeaderSearchBarView",
);

// screensEnabled() returning false makes @react-navigation/bottom-tabs'
// ScreenFallback fall back to plain Views instead of trying to render Screen/
// ScreenContainer with native-only props — the simplest correct default here.
export const screensEnabled = () => false;
export const enableScreens = () => {};
export const enableFreeze = () => {};
export const freezeEnabled = () => false;
export const isSearchBarAvailableForCurrentPlatform = () => false;
