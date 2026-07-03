---
title: 'React inside a vi.mock() factory — top-level ESM import when used lazily, require() only when used synchronously'
track: knowledge
category: conventions
module: client
tags: [vitest, mocking, react, esm, hoisting, eslint]
applies_to: [client/**/__tests__/*.test.tsx, client/**/*.test.tsx]
created: '2026-06-22'
---

# React inside a vi.mock() factory — top-level ESM import when used lazily, require() only when used synchronously

## Rule

When a `vi.mock(...)` factory needs `React` (to build a stub via `React.createElement`), prefer a **top-level `import React from "react"`** and reference it inside the factory. Reach for `const React = require("react")` **only** when `React` is needed **synchronously in the factory body** (i.e. evaluated the moment the hoisted factory runs), which is rare. The deciding question is *when* the `React` reference executes, not *where* it textually sits.

- **`React.createElement` inside a returned render function** (`Camera = vi.fn(({ ... }) => React.createElement(...))`) runs **lazily**, at render time — long after every ESM `import` binding is initialized. A top-level `import React` is the correct, lint-clean choice. This is the dominant case.
- **`React` dereferenced in the factory body itself** (before returning) runs during the hoisted factory's synchronous execution. A top-level `const React = ...` (runtime statement) is not yet initialized at that point, so `require("react")` is the escape hatch — and it must carry `// eslint-disable-next-line @typescript-eslint/no-require-imports` with a one-line reason.

Do not blindly copy the `require()` form from a neighboring test: it is the exception, not the house style.

## Why

`vi.mock(...)` calls are hoisted to the top of the file and execute before runtime statements. That fact is often misremembered as "you can never reference a top-level import inside a factory" — true only for code that runs *synchronously in the factory body*. ESM `import` bindings are initialized before any hoisted factory runs, and a factory's returned render function executes later still (when the mocked component renders). So a top-level `import React` is safely in scope inside a lazily-executed render fn. Using `require()` there is dead weight that trips `@typescript-eslint/no-require-imports` and needs a suppression comment to silence — noise for a problem that does not exist.

## Examples

```typescript
// Good — React used lazily inside the returned render fn: top-level ESM import.
import React from "react";

vi.mock("react-native-vision-camera", () => {
  const Camera = vi.fn(({ testID }: { testID?: string }) =>
    // runs at render time; `React` is initialized by then
    React.createElement("div", { "data-testid": testID ?? "camera" }),
  );
  return { Camera, useCameraDevice: vi.fn() };
});
```

```typescript
// Acceptable only when React is needed synchronously in the factory body.
vi.mock("@react-native-community/slider", () => {
  // `require` is used here because vi.mock factories are hoisted above ES imports,
  // and this factory dereferences React during its own (synchronous) execution.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  return { default: (p: { testID?: string }) => React.createElement("div", { "data-testid": p.testID }) };
});
```

## Exceptions

If a factory genuinely builds a React value at hoist time (not inside a returned render fn), keep `const React = require("react")` plus the `@typescript-eslint/no-require-imports` disable and an explanatory comment, as in `SearchFilterSheet.test.tsx`. This is the only case where `require()` is warranted.

## Related Files

- `client/camera/components/__tests__/CameraView.test.tsx` — converted to the lazy/top-level-ESM form
- `client/components/__tests__/HomeRecipeCard.test.tsx` — existing precedent for top-level `import React` referenced inside a `vi.mock` factory
- `client/components/meal-plan/__tests__/SearchFilterSheet.test.tsx` — the `require()` exception with the documented hoisting comment

## See Also

- [Intentional useEffect dependencies — document the WHY](intentional-useeffect-dependencies-2026-05-13.md)
- [rn-component-render-test-jsdom-pattern](rn-component-render-test-jsdom-pattern-2026-05-16.md)
