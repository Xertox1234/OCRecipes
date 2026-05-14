---
title: "`setTimeout` in test fixtures vs. real async waits"
track: knowledge
category: conventions
tags: [testing, vitest, async, fake-timers, flakiness, audit-triage]
module: shared
applies_to: ["**/__tests__/**/*.test.ts", "**/__tests__/**/*.test.tsx"]
created: 2026-05-13
---

# `setTimeout` in test fixtures vs. real async waits

## Rule

Not all `setTimeout` in tests is a flake risk. Distinguish two patterns — one is fixture behavior (don't migrate to fake timers), the other is a real async wait (replace with deterministic polling).

## Examples

### Pattern A — `setTimeout` is part of the test fixture (NOT a flake risk)

```typescript
// ✅ The setTimeout simulates async work for the function under test.
// promise-memo memoizes in-flight promises; the fixture needs the work to
// take *some* time so concurrent calls land in the same memo window.
const memo = createPromiseMemo(async () => {
  await new Promise((r) => setTimeout(r, 10)); // ← fixture, not flake
  return "session-123";
});

const p1 = memo.call();
const p2 = memo.call();
expect(p1).toBe(p2); // both calls hit the same in-flight promise
```

The `setTimeout` here is a _behavior_ of the fixture — it's how the test simulates "async work that takes time." 10ms on any modern CI is fine. Don't migrate to `vi.useFakeTimers()` — that adds complexity without reducing flakiness.

### Pattern B — `setTimeout` is waiting on a real async side effect (genuinely flaky)

```typescript
// ❌ Wall-clock wait for a fire-and-forget DB write to complete.
// On a slow CI runner the 50ms may not be enough → flake.
await setMicronutrientCache("key", data, ttl);
await getMicronutrientCache("key");  // triggers fire-and-forget hit-count update
await new Promise((r) => setTimeout(r, 50)); // ← real wait, real flake risk

const [row] = await tx.select(...).where(...);
expect(row.hitCount).toBe(1); // may fail on slow CI
```

For Pattern B, the correct fix is deterministic polling, NOT `vi.useFakeTimers()` (which doesn't help with real async DB ops):

```typescript
async function waitForCondition(
  check: () => Promise<boolean>,
  timeoutMs = 1000,
  pollMs = 20,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(`Condition not met within ${timeoutMs}ms`);
}
```

## Audit triage rule

When auditing test flakiness, look at what the `setTimeout` is waiting for. If it's inside the test's mock/fixture body, it's setting up the test scenario — not a flake. If it's between an action and an assertion, waiting for a real async side effect to land, it IS a flake risk and needs polling.

**Origin:** Audit 2026-05-11 finding H1 (initially "4 files with flaky timers" → reclassified after inspection: 1 genuinely flaky `cache.test.ts` fire-and-forget + 1 trivial microtask wait in `profile.test.ts` + 2 false-positive fixture timers in `promise-memo.test.ts`/`serial-queue.test.ts`).

## See Also

- [Module-level cache variable not reset between tests](module-level-cache-not-reset-between-tests-2026-05-13.md)
- [When inline `vi.mock` of globally-aliased modules IS correct](inline-vi-mock-globally-aliased-modules-2026-05-13.md)
