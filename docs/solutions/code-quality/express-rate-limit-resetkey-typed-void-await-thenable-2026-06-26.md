---
title: express-rate-limit middleware.resetKey is typed `() => void` though async — awaiting it trips await-thenable
track: bug
category: code-quality
module: server
severity: low
tags: [express-rate-limit, typescript, eslint, await-thenable, rate-limiting, testing]
symptoms: ['@typescript-eslint/await-thenable: "Unexpected iterable of non-Promise (non-"Thenable") values passed to promise aggregator" on a Promise.all over limiter.resetKey() calls', Type-aware ESLint (CI gate / pre-commit preflight) rejects code that awaits limiter.resetKey() even though the runtime call returns a Promise]
applies_to: [server/**/*.ts]
created: '2026-06-26'
---

# express-rate-limit middleware.resetKey is typed `() => void` though async — awaiting it trips await-thenable

## Problem

You reset rate-limit buckets between tests (or anywhere) via the middleware's
`resetKey`, and try to await the batch:

```ts
// ❌ trips @typescript-eslint/await-thenable
await Promise.all([
  ...Array.from(accountKeys, (k) => loginAccountLimiter.resetKey(k)),
  ...Array.from(ipKeys, (k) => loginLimiter.resetKey(k)),
]);
```

The type-aware ESLint gate (CI's `Lint·Types·Patterns` check, and the local
pre-commit preflight) fails with:

```
Unexpected iterable of non-Promise (non-"Thenable") values passed to promise aggregator  @typescript-eslint/await-thenable
```

## Symptoms

- `await-thenable` fires on the `Promise.all([...])` line, not on `resetKey` itself.
- The runtime works (the await is harmless at runtime) — this is a **types-vs-runtime mismatch** the lint rule correctly flags, so it only surfaces under type-aware lint, never at `tsc --noEmit` or runtime.

## Root Cause

express-rate-limit (v8.5.2) types the **middleware's** `resetKey` as a
synchronous `(key: string) => void` (`RateLimitRequestHandler` in
`node_modules/express-rate-limit/dist/index.d.ts:240`), even though the
**store's** `resetKey` is declared `async` (`dist/index.cjs:129`). The middleware
just binds the store method onto itself (`middleware.resetKey =
config.store.resetKey.bind(config.store)`, `dist/index.cjs:1005`) but keeps the
`void` signature. So at the type level, `limiter.resetKey(k)` is `void`, and
`Promise.all` over `void` values is "awaiting non-thenables" — exactly what
`await-thenable` forbids.

Crucially the default `MemoryStore.resetKey` body is **two synchronous
`Map.delete` calls with no internal `await`** (`dist/index.cjs:129-131`), so the
bucket is cleared the instant the call is made; the returned promise is
already-resolved ceremony. There is nothing to await.

## Solution

Call `resetKey` in a plain synchronous loop. No `Promise.all`, no `await` — this
matches both the declared `void` type and the synchronous runtime:

```ts
// ✅ lint-clean and correct: MemoryStore clears synchronously
beforeEach(() => {
  for (const key of touchedAccountKeys) loginAccountLimiter.resetKey(key);
  for (const key of touchedIpKeys) loginLimiter.resetKey(key);
  touchedAccountKeys.clear();
  touchedIpKeys.clear();
});
```

Note the middleware exposes `resetKey` and `getKey` but **not** `resetAll` (only
those two are assigned at `dist/index.cjs:1005-1006`), so per-key reset is the
only built-in lever — track the keys you touch and reset exactly those.

## Prevention

- Before wrapping a library method's return in `Promise.all`/`await`, check its
  **declared** return type, not its runtime behavior — a method can be `async`
  internally yet typed `() => void` (or `void`) at the surface you call.
- If a synchronous-typed reset clears state synchronously, prefer a sync loop;
  reach for `await` only when the type is actually `Promise`/`Thenable`.

## Related Files

- `server/routes/__tests__/auth-account-throttle.test.ts` — the `beforeEach`
  store-reset that surfaced this (PR #462).
- `server/routes/_rate-limiters.ts` — `loginLimiter` / `loginAccountLimiter`
  whose `resetKey` is called.

## See Also

- `await-thenable` is one of the type-aware ESLint rules gated in CI (`Lint·Types·Patterns`) and in the local pre-commit preflight — which is why a runtime-harmless `await` is a hard failure here rather than a warning.
