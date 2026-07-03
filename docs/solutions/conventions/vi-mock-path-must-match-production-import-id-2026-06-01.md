---
title: vi.mock path must resolve to the same module ID as the production import
track: knowledge
category: conventions
module: client
tags: [testing, vitest, mocks, jsdom, alias, expo, context-providers]
applies_to: [client/**/__tests__/**/*.test.ts, client/**/__tests__/**/*.test.tsx]
created: '2026-06-01'
last_updated: '2026-06-01'
---

# vi.mock path must resolve to the same module ID as the production import

## Rule

`vi.mock(specifier)` is keyed by the **resolved module ID**, and the `specifier`
is resolved **relative to the test file** — not relative to the module that does
the importing. When the production module under test imports a collaborator with
a _relative_ path (e.g. `client/context/PremiumContext.tsx` does
`import { useAuthContext } from "./AuthContext"`), a test sitting in a
`__tests__/` subdirectory must NOT copy that same `./AuthContext` string: from
`client/context/__tests__/PremiumContext.test.ts`, `./AuthContext` resolves to
the non-existent `client/context/__tests__/AuthContext`, so the mock silently
**does not apply** and the real collaborator loads.

Mock via the `@/` alias (or the correct `../`), so the mock's resolved ID matches
the production import's resolved ID:

```typescript
// PremiumContext.tsx:  import { useAuthContext } from "./AuthContext";
// Test file lives in client/context/__tests__/ — use the alias, NOT "./AuthContext":
vi.mock("@/context/AuthContext", () => ({
  useAuthContext: () => ({ isAuthenticated: true }),
}));
```

Vitest resolves both the production `./AuthContext` import and the test's
`@/context/AuthContext` mock to the same file ID (the `@/` -> `client` alias is in
`vitest.config.ts`), so the mock applies.

## Why

A mismatched mock path fails **silently** — there is no "mock not found" error.
The real collaborator loads instead, dragging its whole import graph in. Under
the jsdom test environment that graph (AuthContext -> `@/lib/query-client` ->
`@react-native-community/netinfo` / `@sentry/react-native` -> `expo`) hits Expo's
async-require entry, which runs only when `typeof window !== "undefined"`:

```
Error: Cannot find module './setupFastRefresh'
 at node_modules/expo/src/async-require/setup.ts:7
```

The error names Expo, not the mock — so the real cause (a wrong `vi.mock` path)
is invisible. The fix is always to correct the mock specifier so it resolves to
the same ID the production code imports, not to chase the Expo error.

## When this applies

- Any context/provider or hook test under `client/**/__tests__/` that mocks a
  sibling module the SUT imports with a relative `./X` path.
- Symptom to recognize: a jsdom suite fails to load (0 tests) with the Expo
  `setupFastRefresh` / `async-require/setup.ts` error, even though you "mocked"
  the dependency that pulls in the native graph.

## Examples

- `client/context/__tests__/PremiumContext.test.ts` — mocks `@/context/AuthContext`
  (PremiumContext imports `./AuthContext`); seeds the real TanStack QueryClient
  cache per query key so `usePremiumContext` derivation runs without a fetch.
- `client/context/__tests__/OnboardingContext.test.ts` — mocks `@/context/AuthContext`,
  `@/lib/query-client`, `@/lib/logger` (all alias paths) to exercise the real
  `OnboardingProvider` / `useOnboarding`.
- `client/context/__tests__/ThemeContext.test.ts` — canonical jsdom + `renderHook`
  provider-test template.

## Related Files

- `client/context/__tests__/PremiumContext.test.ts`
- `client/context/__tests__/OnboardingContext.test.ts`
- `client/context/__tests__/ThemeContext.test.ts`
- `client/context/PremiumContext.tsx`
- `vitest.config.ts`

## See Also

- [When inline `vi.mock` of globally-aliased modules IS correct](inline-vi-mock-globally-aliased-modules-2026-05-13.md)
- [RN component render test jsdom pattern](rn-component-render-test-jsdom-pattern-2026-05-16.md)
