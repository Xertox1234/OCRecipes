---
title: DSN-gated Sentry reporter pattern for Expo / React Native
track: knowledge
category: conventions
module: client
tags: [sentry, observability, react-native, expo, testing, logger, migration]
applies_to: [client/lib/reporter.ts, client/lib/logger.ts, client/**/*.ts, client/**/*.tsx]
created: '2026-05-31'
last_updated: '2026-05-31'
---

# DSN-gated Sentry reporter pattern for Expo / React Native

## Rule

Read `EXPO_PUBLIC_SENTRY_DSN` at module load time in `client/lib/reporter.ts`.
Both `initReporter()` and `reportError()` must be no-ops when that variable is
absent. **Never call `Sentry.init` with an undefined or empty DSN** — doing so
sends malformed telemetry to sentry.io with no project association and may throw
at runtime.

In the Vitest test environment, prevent native module resolution by adding a
`resolve.alias` entry in `vitest.config.ts` that maps `@sentry/react-native` to
`test/mocks/sentry-react-native.ts` (a file of `vi.fn()` stubs). This is the
same pattern used for `expo-haptics`, `react-native-reanimated`, etc.

Also note: client/lib/logger.ts has `warn()` and `info()` wholly inside
`if (__DEV__)` — they are DEV-ONLY and produce NO output in production. Only
`logger.error()` has a production path (it calls `reportError()` to the Sentry
reporter). THEREFORE, when migrating `console.*` calls to `logger.*`: a
`console.error` becomes `logger.error`, and a routine dev-diagnostic
`console.warn`/`console.info` can become `logger.warn`/`logger.info` — BUT an
unconditional `console.warn` whose intent is PRODUCTION VISIBILITY (e.g. a
comment says "warn unconditionally so the failure is visible in production
logs") MUST become `logger.error`, never `logger.warn`, or the migration
silently re-hides the log in prod (the exact H7 failure the migration exists
to fix). Also note: `logger.error(message, error?)` takes the message FIRST
and a single optional error second — it is NOT a drop-in for a bare
`.catch(console.error)` callback (which would pass the rejection reason as the
message); wrap it as `.catch((err) => logger.error("context", err))`.

## Why

This pattern lets the observability wiring (`ErrorBoundary.onError`,
`QueryCache.onError`, `logger.error`) be committed and shipped before a live
Sentry project exists. The DSN is supplied at deploy time via the environment
variable — no call-site changes needed. Without the DSN guard, shipping the
wiring before the DSN is set silently spams sentry.io.

## Examples

```typescript
// client/lib/reporter.ts — the only file that imports @sentry/react-native
import * as Sentry from "@sentry/react-native";

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;

export function initReporter(): void {
  if (!dsn) return;          // no-op until DSN is configured at deploy time
  Sentry.init({ dsn });
}

export function reportError(error: unknown, context?: string): void {
  if (!dsn) return;          // no-op; dev uses logger.error → console instead
  if (context) {
    Sentry.addBreadcrumb({ message: context, level: "error" });
  }
  Sentry.captureException(error);
}
```

```typescript
// client/lib/logger.ts — never imports Sentry directly; routes via reporter
import { reportError } from "@/lib/reporter";

export const logger = {
  error(message: string, error?: unknown): void {
    if (__DEV__) {
      console.error(`[error] ${message}`, error);
    } else {
      reportError(error ?? new Error(message), message);
    }
  },
  // warn/info are dev-only console calls (no prod reporter traffic)
};
```

```typescript
// vitest.config.ts — alias prevents @sentry/react-native native entry loading
resolve: {
  alias: {
    "@sentry/react-native": path.resolve(
      __dirname,
      "./test/mocks/sentry-react-native.ts",
    ),
  },
},
```

```typescript
// test/mocks/sentry-react-native.ts
import { vi } from "vitest";
export const init = vi.fn();
export const captureException = vi.fn();
export const captureMessage = vi.fn();
export const addBreadcrumb = vi.fn();
export const withScope = vi.fn((cb: (scope: unknown) => void) => cb({}));
export const wrap = vi.fn((component: unknown) => component);
```

## Related Files

- `client/lib/reporter.ts` — source of truth; single Sentry import point
- `client/lib/logger.ts` — leveled logger; uses `reportError` for prod errors
- `client/lib/query-client.ts` — `QueryCache.onError` calls `reportError`
- `client/App.tsx` — calls `initReporter()` at startup; passes `onError` to ErrorBoundary
- `vitest.config.ts` — `@sentry/react-native` alias
- `test/mocks/sentry-react-native.ts` — vi.fn() stubs

## See Also

- [Process-level error handlers](./process-level-error-handlers-2026-05-13.md) — server-side equivalent (uncaughtException / unhandledRejection)
- [Dev conditional require for mock vs real module](../design-patterns/dev-conditional-require-mock-vs-real-module-2026-05-13.md) — related native-module isolation pattern (IAP)
