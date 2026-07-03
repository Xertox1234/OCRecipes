---
title: 'Retry delay array read at index -1 returns undefined, defaulting to maximum backoff on first attempt'
track: bug
category: logic-errors
module: client
severity: low
tags: [offline-queue, retry, array-indexing, backoff]
symptoms: [First drain attempt after reconnect takes 8 seconds instead of firing immediately, Fake-timer drain tests hang indefinitely waiting for an 8000ms delay that should be 0ms, Queue items feel slow to replay even on strong connections]
applies_to: [client/lib/offline-queue-drain.ts]
created: '2026-06-12'
---

# Retry delay array read at index -1 returns undefined, defaulting to maximum backoff on first attempt

## Problem

In an offline mutation queue drain loop, `incrementAttempts` is called **before** the `apiRequest` to survive force-quit. After the increment, `current.attempts` is `1` on the first attempt. The retry delay array is indexed as `RETRY_DELAYS_MS[current.attempts - 1]`, which gives index `0` → `0ms` (correct).

However, if the pattern is written as `RETRY_DELAYS_MS[current.attempts - 1]` and `current.attempts` is still `0` at the index read (e.g. when `incrementAttempts` is async and the `current` snapshot is captured before the await resolves), the index becomes `-1`. In JavaScript, `array[-1]` is `undefined`, not an error. A fallback `?? 8000` then silently substitutes the maximum backoff.

```ts
// BUGGY — captures attempts=0 before increment resolves:
const delayMs = RETRY_DELAYS_MS[current.attempts - 1] ?? 8000;
// => RETRY_DELAYS_MS[-1] = undefined ?? 8000 = 8000ms on first attempt

// CORRECT — clamp the index so 0 maps to index 0:
const delayMs = RETRY_DELAYS_MS[Math.max(0, current.attempts - 1)] ?? 8000;
// => RETRY_DELAYS_MS[0] = 0ms on first attempt
```

## Symptoms

- First attempt fires 8 seconds late (the `?? 8000` fallback)
- `vi.useFakeTimers()` drain tests stall: `vi.runAllTimers()` does not advance past the unexpected 8s delay (Vitest fake-timer resolution is async; use `await vi.runAllTimersAsync()`)
- Items retry correctly on attempts 2-4 but the first is inexplicably slow

## Root Cause

JavaScript arrays return `undefined` for negative indices (not an error, not `0`). Any nullish-coalescing fallback after a negative index read silently applies the default, obscuring the real issue. This is especially subtle when `incrementAttempts` is async — a stale snapshot of `current` can be read with the pre-increment value.

## Solution

Use `Math.max(0, current.attempts - 1)` as the index:

```ts
const RETRY_DELAYS_MS = [0, 2000, 4000, 8000]; // index 0-3 = attempts 1-4
const MAX_ATTEMPTS = 4;

// After incrementAttempts(item.id):
const current = loadQueue().find((i) => i.id === item.id);
if (!current) return;
const delayMs = RETRY_DELAYS_MS[Math.max(0, current.attempts - 1)] ?? 8000;
if (delayMs > 0) await wait(delayMs);
```

This guarantees: `attempts=1` → index 0 (0ms), `attempts=2` → index 1 (2s), `attempts=3` → index 2 (4s), `attempts=4` → index 3 (8s).

## Prevention

Whenever an array is indexed with `n - 1` where `n` might be `0`, clamp with `Math.max(0, n - 1)`. Avoid `?? fallback` on array reads that are intended to cover all valid indices — the fallback masks out-of-bounds reads rather than surfacing them.

## Related Files

- `client/lib/offline-queue-drain.ts` — `attemptDrain()`, `RETRY_DELAYS_MS` constant
- `client/lib/__tests__/offline-queue-drain.test.ts` — concurrent drain test uses `await vi.runAllTimersAsync()`
