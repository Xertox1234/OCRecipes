---
title: "`@vitest-environment jsdom` pragma required for component tests"
track: knowledge
category: best-practices
tags: [testing, vitest, jsdom, react-native, pragma, automated-enforcement]
module: client
applies_to: ["client/components/**/__tests__/**/*.test.tsx"]
created: 2026-05-13
---

# `@vitest-environment jsdom` pragma required for component tests

## When this applies

Every `.test.tsx` file under `client/components/**/__tests__/` MUST declare the jsdom environment in its first 3 lines.

## Why

`vitest.config.ts` runs in the `node` environment by default. Component tests that render via `@testing-library/react` need DOM globals (`document`, `window`, etc.). Without the pragma, DOM APIs are `undefined` — tests either pass spuriously (assertions never reach the DOM) or fail with confusing `ReferenceError: document is not defined`.

The config used to set this implicitly via `environmentMatchGlobs`, but that option was removed (audit 2026-05-11 L1). The pragma is now the only mechanism.

## Examples

```typescript
// @vitest-environment jsdom
```

The JSDoc form is also accepted:

```typescript
/** @vitest-environment jsdom */
```

## Enforcement

`scripts/check-jsdom-pragma.js` runs in CI and pre-commit (lint-staged) and errors on any in-scope `.test.tsx` file missing the pragma. The check is intentionally scoped to `client/components/**/__tests__/` — tests for extracted pure functions or hooks elsewhere don't need DOM and don't need the pragma.

## Related Files

- `scripts/check-jsdom-pragma.js`
- `vitest.config.ts`

## See Also

- [Pressable `fireEvent` in JSDOM: use `click`, not `press`](../conventions/pressable-fireevent-click-not-press-jsdom-2026-05-13.md)
- [Vitest alias mocks for native-only React Native libraries](../design-patterns/vitest-alias-mocks-native-libraries-2026-05-13.md)
