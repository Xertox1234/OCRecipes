---
title: '`__DEV__` conditional require for mock vs real module switching'
track: knowledge
category: design-patterns
module: client
tags: [react-native, iap, dev-stub, conditional-import, metro, mocking]
applies_to: [client/lib/iap/**/*.ts, client/**/index.ts]
created: '2026-05-13'
---

# `__DEV__` conditional require for mock vs real module switching

## When this applies

When a client-side module needs a development stub that _cannot coexist_ with the real implementation because the real module only loads on native builds. The IAP module is the canonical case: `expo-iap` requires a native build and crashes in Expo Go, so dev sessions must load a mock.

## Why

Three approaches were evaluated; `__DEV__` won:

| Approach                        | Pros                                                                                            | Cons                                                                                   |
| ------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `__DEV__`                       | Automatically correct in dev vs prod; no config needed; Metro strips dead branch in prod builds | Requires `eslint-disable` for `require()`                                              |
| `EXPO_PUBLIC_USE_MOCK_IAP=true` | Standard env pattern                                                                            | Easy to misconfigure; env vars persist across builds; developer must remember to unset |
| Dynamic `await import()`        | No `require()`                                                                                  | Async at module load; complicates hook initialization                                  |

`__DEV__` is Metro's build-time global. In a production native build, the `if (USE_MOCK)` branch becomes dead code and Metro tree-shakes the mock module out of the bundle entirely.

## Examples

```typescript
// client/lib/iap/index.ts
const USE_MOCK = __DEV__;

let _useIAP: () => UseIAPResult;

if (USE_MOCK) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mock = require("./mock-iap");
  _useIAP = mock.useIAP;
} else {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const expoIap = require("expo-iap");
  _useIAP = expoIap.useIAP;
}

export const useIAP: () => UseIAPResult = _useIAP;
```

### Key details

1. `_useIAP` is explicitly typed as `() => UseIAPResult` — do not leave it as `any` (a real code-review finding).
2. The `require()` calls need `eslint-disable` comments because the project's ESLint config forbids CommonJS `require`.
3. Both branches must conform to the same `UseIAPResult` interface. The type contract _is_ the abstraction boundary.

This is the React Native equivalent of the server-side "stub service with production safety gate" pattern: the dev branch is allowed only in `__DEV__`, the prod branch enforces real behaviour.

## Exceptions

If both branches _can_ coexist (no native dependency, no Expo Go crash), prefer a runtime feature flag or dependency injection. `__DEV__` switching trades flexibility for safety, and the safety only matters when the real module is unusable in the dev environment.

## Related Files

- `client/lib/iap/index.ts` — the conditional require
- `client/lib/iap/mock-iap.ts` — the dev stub
- `client/lib/iap/usePurchase.ts` — consumer

## See Also

- [Lazy-singleton external service clients so tests can import the module](../conventions/lazy-singleton-external-clients-test-import-2026-05-13.md) — server-side complement (same "don't load the wrong implementation at import time" problem)
- [Mounted ref guard for async hooks](mounted-ref-guard-async-hooks-2026-05-13.md) — used inside `usePurchase`, the consumer of this pattern
