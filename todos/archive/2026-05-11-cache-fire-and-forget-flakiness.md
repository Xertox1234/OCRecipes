---
title: "Replace wall-clock setTimeout waits with deterministic polling in cache tests"
status: backlog
priority: medium
created: 2026-05-11
updated: 2026-05-11
assignee:
labels: [testing, flakiness, deferred, audit-2026-05-11]
github_issue:
---

# Replace wall-clock setTimeout waits with deterministic polling in cache tests

## Summary

Two tests in `server/storage/__tests__/cache.test.ts` use `await new Promise(r => setTimeout(r, N))` (50ms and 100ms) to wait for "fire-and-forget" hit-count DB updates to flush before asserting. On a slow or loaded CI runner, the 50ms wait can be too short, causing intermittent failures. Replace with deterministic polling.

## Background

Surfaced by audit 2026-05-11 (finding H1 in `docs/audits/2026-05-11-testing.md`). The original H1 finding bundled 4 files but post-investigation only this one is genuinely flaky:

- **`cache.test.ts:537` and `:582`** — real fire-and-forget DB writes; wall-clock waits genuinely flaky
- `profile.test.ts:103` — fire-and-forget microtask; trivial to replace with `await Promise.resolve()` or `setImmediate`
- `promise-memo.test.ts` and `serial-queue.test.ts` — `setTimeout` is inside the test's mock function simulating async work for the function-under-test; not waiting on a real production timer. 10–50ms delays are not a flake source on any modern runner. **Not a real H1.**

Cleanup of `profile.test.ts` is a one-line change (`setTimeout(10)` → `setImmediate`); it can be rolled into this todo as a sidecar fix.

## Acceptance Criteria

### Primary fix — cache.test.ts

- [ ] Replace `await new Promise(r => setTimeout(r, 50))` at `cache.test.ts:537` with a polling helper:

  ```typescript
  async function waitForHitCount(
    queryKey: string,
    expected: number,
    timeoutMs = 1000,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const { eq } = await import("drizzle-orm");
      const [row] = await tx
        .select({ hitCount: schema.micronutrientCache.hitCount })
        .from(schema.micronutrientCache)
        .where(eq(schema.micronutrientCache.queryKey, queryKey));
      if (row?.hitCount === expected) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`hitCount did not reach ${expected} for ${queryKey}`);
  }
  ```

- [ ] Same treatment for `cache.test.ts:582`
- [ ] Extract the helper to `test/utils/wait-for.ts` if more tests would benefit
- [ ] Tests still pass and are deterministic — run repeatedly (`vitest run cache.test.ts --repeat=20`) to verify no flakes
- [ ] Polling helper has a clear timeout-failure error message, not a silent pass

### Sidecar fix — profile.test.ts

- [ ] Replace `setTimeout(r, 10)` at `profile.test.ts:103` with `await new Promise(setImmediate)` (Node) or `await Promise.resolve()` chain
- [ ] Verify the assertion that `storage.invalidateSuggestionCacheForUser` was called still works

### Alternative (consider in implementation, more invasive)

Refactor `getMicronutrientCache` / similar to return both the cached value and a `Promise<void>` for the hit-count update. Tests can `await` the promise instead of waiting. Cleaner long-term but touches production code, so prefer the polling approach unless the same pattern shows up in 3+ places.

## Implementation Notes

- Don't use `vi.useFakeTimers()` for the cache tests — the wait is for real async DB operations, not timer callbacks
- The polling helper is a pure-test utility; keep it in `test/utils/` or co-located with the test
- 20ms poll interval × 50 iterations = 1s default timeout — generous enough for slow CI

## Dependencies

None.

## Risks

- Low. Polling is well-understood and the timeout failure mode is loud.

## Related Audit Finding

- 2026-05-11 audit, finding H1: original scope (4 files) reclassified as 1 genuinely flaky (cache.test.ts) + 1 trivially improvable (profile.test.ts) + 2 false-positive (promise-memo, serial-queue — setTimeout is part of the test fixture, not a real flake risk).
