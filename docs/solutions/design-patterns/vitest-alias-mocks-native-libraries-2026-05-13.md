---
title: Vitest alias mocks for native-only React Native libraries
track: knowledge
category: design-patterns
module: client
tags: [testing, vitest, react-native, native-modules, mocks, alias]
applies_to: [vitest.config.mts, test/mocks/**/*.ts]
created: '2026-05-13'
last_updated: '2026-10-01'
---

# Vitest alias mocks for native-only React Native libraries

## When this applies

When a React Native library uses native code that can't run in Node.js (e.g. `expo-linear-gradient`, `react-native-vision-camera`), Vitest will throw at import time. Fix: create a minimal pass-through mock and register it as a module alias.

## Why

Vitest evaluates imports in Node. Native modules try to call into iOS/Android binaries that don't exist in Node, throwing at import. A module alias short-circuits import resolution to a stub file that returns a JS-only equivalent (typically a `View` for visual components).

## Examples

### Step 1 — Create the mock at `test/mocks/<package-name>.ts`

```typescript
// test/mocks/expo-linear-gradient.ts
import React from "react";
import { View } from "react-native";

export const LinearGradient = ({
  children,
  ...props
}: React.ComponentProps<typeof View>) =>
  React.createElement(View, props, children);
```

### Step 2 — Register in `vitest.config.mts` under `resolve.alias`

```typescript
resolve: {
  alias: {
    "expo-linear-gradient": path.resolve(__dirname, "test/mocks/expo-linear-gradient.ts"),
  },
},
```

## When to use

Any library that crashes Vitest with "native module could not be found" or similar import errors in the test environment.

## Gotcha — an alias does not reach an externalized package

`resolve.alias` is applied by Vite, so it only affects modules Vite processes. A
`node_modules` package that Vitest *externalizes* (ESM under a nested
`"type":"module"` `package.json`, or plain CJS) is loaded by Node, and its own
`import "react-native"` skips the alias and lands on the real Flow entry:
`SyntaxError: Unexpected token 'typeof'`, with no file named.
`@react-navigation/native` is the worked case. Either alias the package itself to
a stub (the real one is never loaded) or add it to `test.server.deps.inline` so
Vite processes it and the alias reaches it — see
[the Flow-syntax transform failure](../runtime-errors/mock-native-svg-flow-syntax-transform-failure-2026-07-12.md)
for the measured cause and the fix.

## Related Files

- `test/mocks/expo-linear-gradient.ts`
- `vitest.config.mts`

## See Also

- [When inline `vi.mock` of globally-aliased modules IS correct](../conventions/inline-vi-mock-globally-aliased-modules-2026-05-13.md)
- [A component that transitively imports react-native-svg fails render tests with a misleading 'Unexpected token typeof'](../runtime-errors/mock-native-svg-flow-syntax-transform-failure-2026-07-12.md) — when the alias is bypassed by an externalized package
