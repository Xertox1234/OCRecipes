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
- `react-native-screens` has the same transitive-Flow-import shape as
  `react-native-svg` (both eventually import `react-native/Libraries/
  Utilities/codegenNativeComponent`) and is not yet aliased. The next test
  that renders anything pulling in `@react-navigation/bottom-tabs` (or
  otherwise reaching `react-native-screens`) will very likely hit this same
  failure mode — apply the same alias-a-mock fix rather than re-deriving
  root cause from scratch.

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
