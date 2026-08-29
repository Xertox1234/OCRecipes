---
title: "A component that transitively imports react-native-svg (or another package shipping Flow-syntax internals) fails render tests with a misleading 'Unexpected token typeof'"
track: bug
category: runtime-errors
tags: [vitest, vite, testing, react-native, flow, transform, oxc, esbuild, react-native-svg]
module: client
symptoms: ["A jsdom render test throws SyntaxError: Unexpected token typeof at TRANSFORM time, before any test body runs (Test Files 1 failed, no tests) — no test in the file even started executing.", "The error message names no failing file, and grepping the test file itself (or its obvious first-party dependencies) for typeof finds nothing suspicious.", "The exact same failure reproduces identically whether Vitest uses its oxc transform or falls back to esbuild (oxc: false in vitest.config.ts) — ruling out a parser-specific bug.", "vi.mock()-ing the suspected offending import specifier does NOT fix it — the failure persists even when every module that imports the real package is fully mocked.", "The failure is new on a component/screen that has never had a render test before, even though its individual dependencies (imported and asserted on in isolation) each parse fine on their own."]
created: 2026-07-12
severity: medium
---

# A component that transitively imports react-native-svg (or another package shipping Flow-syntax internals) fails render tests with a misleading "Unexpected token 'typeof'"

## Problem

Writing a full-render jsdom test (`renderComponent(<Screen />)`, per
[rn-component-render-test-jsdom-pattern](../conventions/rn-component-render-test-jsdom-pattern-2026-05-16.md))
for `MealPlanHomeScreen.tsx` failed at Vite/Vitest transform time with
`SyntaxError: Unexpected token 'typeof'` and zero tests executed — no line
number, no file name. The screen's own source, and every one of its
first-party (`client/`) dependencies, parsed cleanly in isolation. The
failure only appeared once the FULL component tree was actually rendered.

## Symptoms

See frontmatter `symptoms`. The critical diagnostic signal: the error
message gives no file/line, and `vi.mock()`-ing the suspected specifier does
**not** make the failure go away, which rules out "just mock harder" as a
fix and points at something outside the normal `vi.mock()` intercept path.

## Root Cause

`CalorieRing.tsx` (one of `MealPlanHomeScreen`'s own child components)
imports `react-native-svg`. The **real** `react-native-svg` package
transitively imports the **real** `react-native` package's deep internals —
specifically Flow-syntax files like
`react-native/index.js`'s `import typeof * as ReactNativePublicAPI from
'./index.js.flow'` and `react-native/Libraries/Utilities/
codegenNativeComponent.js`'s Flow type syntax. Neither Vitest's oxc
transform nor its esbuild fallback can parse Flow — confirmed by bundling
`node_modules/react-native-svg/lib/commonjs/index.js` directly with the
`esbuild` CLI, which reproduces the exact `Unexpected "typeof"` error at
`react-native/index.js:27`.

**Why `vi.mock()` doesn't fix it:** Vitest's dependency-scan/pre-bundle
phase walks the *static* import graph reachable from a test file to decide
what needs transforming, and this scan runs independently of (and before)
any `vi.mock()` interception, which only takes effect at the *runtime*
module-resolution layer once the test body executes. By the time a
`vi.mock("react-native-svg", ...)` call would intercept the import, the scan
phase has already tried — and failed — to parse the real package's Flow
files. The only thing that prevents the scanner from ever reaching the real
file is a `vitest.config.ts`-level `resolve.alias`, which redirects
resolution *before* the scan walks that path at all.

This is the exact same class of problem this project's `test/mocks/
react-native.ts` mock exists to solve for the `react-native` package itself
("the real module uses Flow syntax that Rollup can't parse" — see that
file's header comment) — `react-native-svg` was simply never exercised by
any test before `CalorieRing.tsx`'s render test, so this specific transitive
path had never been hit. `react-native-screens` (a transitive dependency of
`@react-navigation/bottom-tabs`) has the identical issue and is a **latent
next occurrence** of this same bug class — it has not yet been aliased
because no test currently renders anything that reaches it, but the exact
diagnostic steps below apply if one ever does.

## Solution

Add a `resolve.alias` entry in `vitest.config.ts` for the offending
specifier, pointing at a new `test/mocks/<package>.ts` mock file that maps
the package's exported components to their DOM/SVG element equivalents
(mirroring `test/mocks/react-native.ts`'s `mockComponent` pattern) —
**not** a per-test-file `vi.mock()`, which cannot intercept the scan phase.

```ts
// vitest.config.ts
resolve: {
  alias: {
    "react-native-svg": path.resolve(__dirname, "./test/mocks/react-native-svg.ts"),
    // ...existing aliases (react-native, react-native-reanimated,
    // react-native-safe-area-context, @gorhom/bottom-sheet, etc.)
  },
},
```

```ts
// test/mocks/react-native-svg.ts
import React from "react";

function svgEl(tag: string, displayName: string) {
  const Comp = React.forwardRef<unknown, Record<string, unknown>>(
    ({ children, ...rest }, ref) =>
      React.createElement(tag, { ref, ...rest }, children as React.ReactNode),
  );
  Comp.displayName = displayName;
  return Comp;
}

export const Circle = svgEl("circle", "Circle");
export const Defs = svgEl("defs", "Defs");
export const LinearGradient = svgEl("linearGradient", "LinearGradient");
export const Stop = svgEl("stop", "Stop");
// ...cover every named export the project's react-native-svg consumers use

const Svg = svgEl("svg", "Svg");
export default Svg;
```

## Prevention

- When a render test throws an unattributed `SyntaxError` (no file/line) at
  transform time with zero tests executed, **do not assume it's your test
  file's syntax.** Bisect by removing the `renderComponent(<X />)` call
  first (not the mocks) — if removing the render call alone fixes it while
  keeping every `vi.mock()` in place, the crash is in a REAL (unmocked)
  transitive dependency's source, not in your test.
- To find the exact offending file+line, bundle the suspected package's
  resolved entry point directly with the `esbuild` CLI
  (`npx esbuild <path from require.resolve('<pkg>')> --bundle --format=esm
  --platform=node --outfile=/dev/null --log-limit=0`) — this reports every
  parse failure with a precise file and line, unlike Vitest's swallowed
  error. Add `--loader:.png=empty` if an asset import trips first.
- `DEBUG="vite:transform" npx vitest run <file>` prints each file as it
  transforms successfully; the crash happens on whatever comes immediately
  after the last logged line, narrowing the search without a manual bisect.
- `vi.mock()` a package's specifier only stops YOUR test from touching the
  real module at runtime — it does not stop Vitest's dependency scanner
  from trying to parse it. A package that ships Flow-syntax internals (or
  otherwise unparseable source) reachable from ANY statically-imported file
  in the graph needs a `vitest.config.ts` alias, full stop.
- **Confirmed 2026-08-29**: the predicted `react-native-screens` occurrence
  materialized (surfaced while investigating a code-review SUGGESTION for
  PR #873 that wanted a real, unmocked `@react-navigation/native` +
  `@react-navigation/bottom-tabs` integration test). `test/mocks/
  react-native-screens.ts` + a matching `vitest.config.ts` alias were added,
  following this doc's own instructions — verified via the same raw
  `esbuild` CLI bundle technique (Prevention section below) against
  `require.resolve('react-native-screens')`, reproducing the identical
  `Unexpected "typeof"` at `react-native/index.js:27`.
  **This alias alone is necessary but NOT sufficient** to import
  `@react-navigation/native` in this test environment — see the next bullet.
- **New, still-open gap found in the same investigation**: even with the
  `react-native-screens` alias in place, `import { NavigationContainer }
  from "@react-navigation/native"` still fails the same way inside real
  Vitest runs. Bisected one layer with an `esbuild` CLI bundle that applies
  this project's actual `vitest.config.ts` aliases via an `onResolve` plugin
  (more accurate than a bare `esbuild` CLI call, which doesn't see any
  alias): that reproduction surfaced a SEPARATE, unrelated gap — `test/
  mocks/react-native.ts` was missing an `I18nManager` export that
  `NavigationContainer.js` imports directly. Added a minimal `I18nManager`
  mock (`isRTL: false` + the usual constants/methods) — full test suite
  stays green (8170/8170, unchanged). **Even after both fixes, a live
  `npx vitest run` of a file importing `@react-navigation/native` still
  throws the identical `Unexpected token 'typeof'`, while the
  alias-aware `esbuild` CLI bundle of the same import reports `BUILD OK`.**
  This means Vitest's actual dependency-scan/pre-bundle phase (not a plain
  `esbuild` bundle, even one replaying the same aliases) is hitting a THIRD,
  still-unidentified import somewhere in `@react-navigation/native`'s or
  `@react-navigation/core`'s graph — `vitest --clearCache` and manually
  removing `node_modules/.vite` both ruled out a stale-cache explanation.
  **Not resolved.** A follow-up review pass (2026-08-29) ran the
  `DEBUG="vite:transform"` diagnostic named below and got one real datum:
  the log's last entry before the crash is the test file itself — nothing
  transforms after it. The crash therefore never reaches Vite's normal
  transform pipeline at all; whatever the third gap is, it happens earlier,
  somewhere in Vitest's module-loading/dependency-scan step. (A plausible-
  looking SSR-externalization hypothesis was checked and ruled out in the
  same pass — `@react-navigation/native`'s `package.json` `main` points at
  `import`/`export`-syntax source with no `"type": "module"`, so a plain
  CJS `require()` load would fail with `Unexpected token 'export'`, not
  `'typeof'`.) The next person to pick this up should start from "before
  the transform pipeline, in module resolution/scanning" rather than
  re-deriving that narrowing — reach for `DEBUG="vite:deps"` or instrument
  Vitest's optimizer directly, rather than continuing to rely on the
  `esbuild`-CLI-plus-aliases technique, which has now been shown to
  under-report what Vitest's real pipeline hits.

## Related Files

- `test/mocks/react-native-svg.ts` — the new mock added for this fix.
- `vitest.config.ts` — the new `react-native-svg` alias, alongside the
  existing `react-native` / `react-native-reanimated` /
  `react-native-safe-area-context` / `@gorhom/bottom-sheet` aliases that
  solve the identical problem for their respective packages.
- `test/mocks/react-native-reanimated.ts` — also gained a missing
  `useAnimatedProps` export in the same change (a separate, unrelated gap:
  `CalorieRing.tsx` uses it for its animated stroke offset — mirrors the
  existing `useAnimatedStyle` mock shape).
- `test/mocks/react-native-screens.ts` — added 2026-08-29, confirming the
  predicted occurrence (see Prevention). Covers the exports consumed by
  `@react-navigation/native-stack` and `@react-navigation/bottom-tabs`.
- `test/mocks/react-native.ts` — gained a missing `I18nManager` export in the
  same 2026-08-29 change, a separate gap found one layer deeper in
  `@react-navigation/native`'s own `NavigationContainer.js`.
- `client/components/CalorieRing.tsx` — the first-ever consumer to surface
  this, via its `import Svg, { Circle, Defs, LinearGradient, Stop } from
  "react-native-svg"`.
- `client/screens/meal-plan/__tests__/MealPlanHomeScreen.test.tsx` — the
  render test whose implementation surfaced this gap.
- `test/mocks/react-native.ts` — the original instance of this exact
  problem class, for the `react-native` package itself (see its header
  comment).

## See Also

- [../conventions/rn-component-render-test-jsdom-pattern-2026-05-16.md](../conventions/rn-component-render-test-jsdom-pattern-2026-05-16.md) — the jsdom + `@testing-library/react` render-test convention this fix keeps intact.
- [bottomsheetmodal-in-child-component-silently-fails-to-present-2026-07-02.md](bottomsheetmodal-in-child-component-silently-fails-to-present-2026-07-02.md) — a different gorhom/native-module gotcha in the same general "native library doesn't behave the way jsdom testing expects" space.
