---
title: Separate server-attempt counter to isolate network errors from eviction budget in offline drain
track: knowledge
category: design-patterns
module: client
tags: [offline-queue, retry, error-classification, network-errors, TypeError]
applies_to: [client/lib/offline-queue-drain.ts, client/lib/**/*.ts]
created: '2026-06-12'
last_updated: '2026-06-20'
---

# Separate server-attempt counter to isolate network errors from eviction budget in offline drain

## Rule

When an offline mutation queue uses a pre-request `incrementAttempts` pattern (increment before the request to survive force-quit), the eviction budget check must use a **separate in-memory server-attempt counter** — not the raw `attempts` field from the queue item — so that network-layer `TypeError` failures (device still offline) do not consume retry slots.

## Why

The pre-request `incrementAttempts` pattern correctly increments `attempts` before every API call to survive app force-quit mid-drain. However, this means `attempts` grows on *every* drain attempt regardless of error class:

- **`TypeError: Network request failed`** — the device is still offline; the item was never actually sent to the server. These should not count against the eviction budget.
- **5xx server errors** — a real server-side failure; these should consume the budget.
- **4xx errors** — permanent failure; evict immediately.

If the eviction check is `current.attempts >= MAX_ATTEMPTS`, a user on a flappy connection can lose a queued food-log entry after 4 offline reconnect attempts that never reached the server.

The fix: maintain a module-level `Map<string, number>` (`serverAttempts`) that counts only server-side failures. Check `svrCount >= MAX_ATTEMPTS` for eviction. Clean up the map entry on success or permanent eviction.

## Examples

**Wrong — eviction uses raw attempts (TypeError counts against budget):**
```ts
} catch (error) {
  const is4xx = error instanceof Error && /^4\d\d:/.test(error.message);
  if (is4xx || current.attempts >= MAX_ATTEMPTS) {
    await dequeue(current.id);
    emitDrainError();
    done = true;
  }
}
```

**Correct — TypeError classified first; separate counter for server errors:**
```ts
// Module level:
const serverAttempts = new Map<string, number>();

// In catch block — network error check MUST come before the budget check.
// Classification branches on the typed `instanceof TypeError` network check
// and `ApiError.status` (NOT message regexes — see 2026-06-20 update below).
} catch (error) {
  if (error instanceof TypeError) {
    // Device still offline — leave item in queue, no budget consumed.
    return;
  }
  // A non-network error reached the server. `apiRequest` throws an `ApiError`
  // carrying a numeric `status`; a non-ApiError / statusless error is treated
  // as a server failure so it still consumes the budget (loop stays bounded).
  const status = error instanceof ApiError ? error.status : undefined;
  const is4xx = status !== undefined && status >= 400 && status < 500;
  const svrCount = (serverAttempts.get(current.id) ?? 0) + 1;
  serverAttempts.set(current.id, svrCount);
  if (is4xx || svrCount >= MAX_ATTEMPTS) {
    await dequeue(current.id);
    serverAttempts.delete(current.id);
    emitDrainError();
    done = true;
  }
}

// Clean up on success:
await dequeue(current.id);
serverAttempts.delete(current.id);

// Clean up on external dequeue:
if (!current) {
  serverAttempts.delete(item.id);
  return;
}
```

## Exceptions

**Durability tradeoff**: `serverAttempts` is in-memory and resets on app cold start. This means a persistently-failing 5xx item gets a fresh 4-attempt budget each session. This is intentional: the 24h TTL in `clearStale()` is the backstop for truly stuck items, and preserving user data (more attempts) is safer than premature eviction.

**Delay inflation side-effect**: `incrementAttempts` is still called on TypeError attempts, so `current.attempts` grows with every drain invocation including offline ones. This means `RETRY_DELAYS_MS` lookups inflate after multiple TypeError cycles, causing the first genuine server attempt after reconnect to incur a longer delay than expected. This is an accepted tradeoff (the delay is cosmetic; the item is not lost). If delay accuracy matters, move `incrementAttempts` to after the TypeError classification check.

**Error shape**: React Native's `fetch` throws a native `TypeError` on network failure (covers RN, web, and the existing network test mocks, which all throw `TypeError`). The `2026-06-20` update dropped the secondary `/network request failed/i` regex: `apiRequest`'s only two reject paths are a native `TypeError` (offline) or an `ApiError` with a numeric `status`, so the typed `instanceof TypeError` check is exhaustive and no plain-`Error` network path reaches this `catch`.

## Related Files

- `client/lib/offline-queue-drain.ts` — `serverAttempts` Map, `attemptDrain()` catch block
- `client/lib/__tests__/offline-queue-drain.test.ts` — "4 consecutive TypeError failures" and "mixed TypeError + 5xx" test cases

## See Also

- [retry-delay-array-index-underflow-zero-attempts-2026-06-12.md](../logic-errors/retry-delay-array-index-underflow-zero-attempts-2026-06-12.md) — companion bug: `Math.max(0, attempts - 1)` index guard for the same drain loop
- [offline-drain-wiring-avoid-circular-import-2026-06-12.md](../conventions/offline-drain-wiring-avoid-circular-import-2026-06-12.md) — wiring `drainQueue` at App.tsx entry point
- [vitest-resetmodules-instanceof-stale-class-identity-2026-06-20.md](../conventions/vitest-resetmodules-instanceof-stale-class-identity-2026-06-20.md) — the test-side `instanceof ApiError` class-identity trap exposed by branching the drain on `ApiError.status`
