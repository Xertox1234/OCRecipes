---
title: "Pure *-utils.ts files can safely import @/lib/logger despite a 'no React or RN dependencies' docstring"
track: knowledge
category: conventions
tags: [logging, testing, react-native, typescript, pure-functions]
module: client
applies_to: [client/**/*-utils.ts, client/screens/**/*-utils.ts]
created: '2026-07-24'
---

# Pure `*-utils.ts` files can safely import `@/lib/logger` despite a "no React or RN dependencies" docstring

## Rule

A pure `*-utils.ts` helper module (extracted for testability outside the RN
render harness) that needs to log a defensive warning or error should use the
project's structured client logger, `logger` from `@/lib/logger` — not a raw
`console.warn`/`console.error` call — even when the file's own header comment
says something like "no React or RN dependencies." That docstring is about
**runtime UI dependencies** (no `react`/`react-native` imports, so Vitest can
test the file without the RN render harness), not a ban on importing
`@/lib/logger`. `logger` itself has zero React/RN imports; its only
non-trivial dependency is `@/lib/reporter` → `@sentry/react-native`, which is
globally aliased to a mock in `vitest.config.ts` (the same mock every test in
the suite already relies on) and is `__DEV__`-gated no-op in production for
`.info`/`.warn` (only `.error` forwards to Sentry). Importing it does not pull
in React Native at test time and does not add any risk the file's testability
goal was protecting against.

## Why

A defensive branch that surfaces "this shouldn't happen but here's the data"
(an unmodeled discriminated-union case, a partition function's fallback
`else`, a schema mismatch caught defensively) needs *some* logging so the gap
is visible in dev/test rather than a silent no-op. The natural first instinct
in a "no dependencies" pure-utils file is to reach for a bare `console.warn`
to avoid violating the file's stated purity contract — but this project
already has established precedent for the opposite: `client/screens/scan-screen-utils.ts`
imports and calls `logger.warn`/`logger.error` directly, and it carries the
same "extracted pure function" shape. Splitting on "is it React/RN" (banned)
vs. "is it a project utility with no React/RN of its own" (fine) is the
correct read of the "no dependencies" comment — treating it as "no imports at
all" is stricter than the file's actual design intent and produces
inconsistent logging conventions across the same file class (raw `console.*`
in some `-utils.ts` files, `logger.*` in others, for the identical situation).

Prefer `logger.warn` (dev-visible, prod-silent) unless the finding
should reach production telemetry, in which case use `logger.error`
(forwards to Sentry via `reportError`) — `logger.warn`/`logger.info` are
deliberately silent in production to avoid spamming Sentry breadcrumbs with
routine messages, so a genuinely actionable defensive branch (e.g. safety or
nutrition data being silently dropped) should weigh `.error` over `.warn`.

## Examples

```typescript
// GOOD — client/screens/nutrition-detail-flags-utils.ts
import { logger } from "@/lib/logger";

// ... inside a pure partition function ...
} else {
  // Defensive default: an unmodeled flag kind has no bucket here.
  logger.warn(
    `partitionScanFlags: unhandled flag kind "${flag.kind}" (id: ${flag.id}) — dropped from both sections`,
  );
}
```

```typescript
// BAD — raw console.* in a project-convention client file
} else {
  console.warn(`unhandled flag kind "${flag.kind}"`); // works, but breaks
  // the project's structured-logger convention (dev/prod behavior + Sentry
  // forwarding) for no real testability benefit — logger has no RN deps.
}
```

A test asserting the log fires can spy on `console.warn` directly (since
`logger.warn` calls it internally under `__DEV__`, which is true in Vitest) —
no need to mock `@/lib/logger` itself:

```typescript
const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
// ... exercise the code path ...
expect(warnSpy).toHaveBeenCalledTimes(1);
warnSpy.mockRestore();
```

## Exceptions

- A module that is genuinely reused **outside** the app runtime (a Node
  script under `scripts/`, a build-time codegen tool) should NOT import
  `@/lib/logger` — that boundary is about execution context, not testability,
  and `logger`/`reporter` assume the Expo/RN app environment (`__DEV__`,
  `EXPO_PUBLIC_SENTRY_DSN`).
- If a future logger dependency ever grows a real React/RN import (unlikely
  given its current design), re-evaluate; this rule holds only as long as
  `@/lib/logger` stays free of `react`/`react-native` imports itself.

## Related Files

- `client/screens/nutrition-detail-flags-utils.ts` — the defensive `partitionScanFlags` branch this rule was extracted from
- `client/screens/scan-screen-utils.ts` — pre-existing precedent for `logger.warn`/`logger.error` in a pure `*-utils.ts` file
- `client/lib/logger.ts` — the structured logger itself (no React/RN imports)
- `client/lib/reporter.ts` — `logger`'s only non-trivial dependency (`@sentry/react-native`), globally mocked in `vitest.config.ts`

## See Also

- [Testing an extracted pure function doesn't prove it's correctly wired into the component](pure-utils-extraction-tests-dont-prove-wiring-2026-07-14.md) — the related "what a `*-utils.ts` extraction test does and doesn't prove" convention
