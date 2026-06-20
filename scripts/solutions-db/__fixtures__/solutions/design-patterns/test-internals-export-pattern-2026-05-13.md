---
title: Test internals export pattern
track: knowledge
category: design-patterns
module: server
tags: [testing, encapsulation, vitest, module-state]
applies_to: [server/routes/**/*.ts, server/services/**/*.ts]
created: "2026-05-13"
---

# Test internals export pattern

## When this applies

Export internal module state for testing via a `_testInternals` object. Use when tests need to manipulate module-scoped state (Maps, counters, constants) that should not be part of the public API.

## Examples

```typescript
// Prefix with underscore to signal non-public API
export const _testInternals = {
  analysisSessionStore,
  userSessionCount,
  MAX_SESSIONS_PER_USER,
  clearSession,
};
```

```typescript
// In tests:
import { _testInternals } from "../photos";

beforeEach(() => {
  _testInternals.analysisSessionStore.clear();
  _testInternals.userSessionCount.clear();
});
```

## Why

Allows tests to manipulate internal state (pre-fill maps, verify cleanup) without exposing implementation details in the public API. The underscore prefix convention signals this is not for production consumers.

## See Also

- [Session timeout cleanup pattern](session-timeout-cleanup-pattern-2026-05-13.md)
- [Bounded in-memory store pattern](bounded-in-memory-store-pattern-2026-05-13.md)
