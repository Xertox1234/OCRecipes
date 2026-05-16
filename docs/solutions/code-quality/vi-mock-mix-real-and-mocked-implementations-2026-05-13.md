---
title: "Mixing Real and Mocked Implementations in vi.mock Storage Facade"
track: bug
category: code-quality
tags: [vitest, vi-mock, storage-facade, async-factory, test-doubles]
module: server
applies_to: ["server/routes/__tests__/**/*.test.ts"]
symptoms:
  - "Tests fail because in-memory session logic was reimplemented as a `vi.fn()` and diverged from production"
  - "Cross-test pollution from leftover module-level state"
  - "Mocking the entire storage facade means hand-writing session lifecycle behavior"
created: 2026-03-26
severity: medium
---

# Mixing Real and Mocked Implementations in vi.mock Storage Facade

## Problem

During the session-store extraction (`server/storage/sessions.ts`), route tests that mock the storage facade needed to handle a mix of DB-backed functions (which should be mocked) and in-memory session functions (which should use real implementations). The naive approach of mocking all storage functions with `vi.fn()` forces the test author to manually re-implement session lifecycle logic in mock return values. That re-implementation is fragile, diverges from production behavior, and breaks when the real implementation changes.

## Symptoms

- Mock session lifecycle drifts from real `sessions.ts` logic
- Behavioral differences between test and production are invisible until they bite
- Tests need maintenance every time the session module evolves

## Root Cause

`vi.mock` replaces the entire module by default. For a storage facade that aggregates many domains, this forces the test author into all-or-nothing mocking. Static imports cannot be used because `vi.mock` hoists to the top of the file — by the time test code runs, the module is already replaced.

## Solution

Use `vi.mock`'s async factory to dynamically import the real module and mix its exports with mocked functions:

```typescript
vi.mock("../../storage", async () => {
  const sessions = await import("../../storage/sessions");
  return {
    storage: {
      // DB-backed functions — mock
      getSubscriptionStatus: vi.fn(),
      getDailyScanCount: vi.fn(),
      // In-memory functions — use real implementation
      canCreateAnalysisSession: sessions.canCreateAnalysisSession,
      createAnalysisSession: sessions.createAnalysisSession,
      getAnalysisSession: sessions.getAnalysisSession,
      clearAnalysisSession: sessions.clearAnalysisSession,
    },
  };
});
```

The factory must be `async` because `vi.mock` hoists to the top of the file — static imports cannot be used; `await import()` is required.

Clear in-memory state in `beforeEach` (including `clearTimeout` on any timer `Map`s) to prevent cross-test pollution.

## Prevention

- When the storage facade mixes DB and in-memory modules, do not mock everything. Pass through the real in-memory functions.
- The `async () => { const mod = await import(...) }` pattern inside `vi.mock` is the way to reference real implementations from a hoisted mock.
- Always reset module-level state in `beforeEach` when the module is shared across tests.

## Related Files

- `server/routes/__tests__/photos.test.ts` — analysis session mock wiring
- `server/routes/__tests__/verification.test.ts` — label session mock wiring
- `docs/legacy-patterns/testing.md` — "Test Internals Export Pattern"

## See Also

- [Module-level cache not reset between tests](../conventions/module-level-cache-not-reset-between-tests-2026-05-13.md)
- [Inline vi.mock for globally aliased modules](../conventions/inline-vi-mock-globally-aliased-modules-2026-05-13.md)
- [Facade mock alignment for re-exported values](../conventions/facade-mock-alignment-re-exported-values-2026-05-13.md)
