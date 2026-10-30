---
title: "Offline-queue drain must classify by status meaning, not status class — a 429/401 or a deploy-window 5xx is not a bad write, and one poison item must not block the queue"
track: bug
category: logic-errors
module: client
tags: [client-state, typescript, offline-queue, retry, error-classification, data-loss, reliability]
applies_to: [client/lib/offline-queue-drain.ts, client/lib/offline-queue.ts, client/App.tsx]
symptoms: ["A food entry logged offline disappears after reconnect with a 'couldn't sync' toast", "Queued writes are lost when several items replay at once and the server rate-limits (429)", "Queued writes are lost during a server deploy or restart window (~15s of 5xx)", "A token refresh in progress (401) discards the user's only copy of a write", "One item the server always 500s on keeps every later queued write unsynced for a day"]
created: '2026-10-30'
severity: high
---

# Offline-queue drain must classify by status meaning, not status class

## Problem

The durable offline queue holds the user's **only copy** of a write. Its drain discarded an item
on *any* 4xx, and after 4 consecutive 5xx (~14s of in-drain backoff). Both rules equate "the
server said no" with "this write can never succeed":

- `429` is the most likely response on a reconnect that replays several items at once; `401`
  arrives while the session-expiry/refresh flow is mid-flight; `408`/`425` are timing conditions.
  None says anything about the request body.
- ~14s of 5xx is a normal deploy/restart window. Evicting there turns a routine deploy into data
  loss for every user who was offline during it.

The first fix ("keep 5xx items queued until the TTL") introduced the opposite failure: the drain
processes items oldest-first and stopped at the first exhausted 5xx, so one **poison** item (a
deterministic server bug on that payload) head-of-line blocked every later write for the whole
24h TTL.

## Symptoms

See frontmatter. The tell is a "couldn't sync" toast that correlates with a reconnect burst or a
deploy, not with anything the user did.

## Root Cause

Branching on the status *class* (`status >= 400 && status < 500`) treats 4xx as "permanent" when
four of its codes are explicitly transient. And "retry budget exhausted" was used as the eviction
signal, when the only evidence a budget gives is "the server is unhealthy *right now*".

## Solution

`attemptDrain` returns a `DrainOutcome` instead of a boolean, and `drainQueue` acts on it:

| Response                       | Outcome     | Item                                  | Drain                       |
| ------------------------------ | ----------- | ------------------------------------- | --------------------------- |
| network `TypeError`            | `pending`   | kept, no budget consumed              | continues                   |
| 2xx, or 404 on a DELETE        | `synced`    | dequeued                              | continues                   |
| 401 / 408 / 425 / 429          | `halt`      | kept                                  | **stops now**               |
| other 4xx (400/403/404/409/422) | `discarded` | dequeued + error toast               | continues                   |
| 5xx past in-drain budget       | `deferred`  | kept, fresh budget next drain         | continues; **2 in a row → stop** |
| 5xx past budget AND age > TTL  | `discarded` | dequeued + error toast                | continues                   |

```ts
const TRANSIENT_4XX = new Set([401, 408, 425, 429]);
// ...
let consecutiveDeferrals = 0;
for (const item of sorted) {
  const outcome = await attemptDrain(item);
  if (outcome === "synced") anySynced = true;
  if (outcome === "halt") break;
  if (outcome === "deferred") {
    if (++consecutiveDeferrals >= 2) break; // systemic outage, not a poison item
  } else consecutiveDeferrals = 0;
}
```

One deferral is tolerated (skip past a possible poison item); a second in a row means the server
itself is down, so the drain stops instead of paying ~14s of backoff on every remaining item.
Because a kept item now waits for the *next* drain, the drain also needs a trigger beyond
reconnect: `App.tsx` drains on `focusManager.subscribe` (app foreground) too.

## Prevention

- When a durable store is the only copy, the default for an unclassified failure is **keep**.
  Evict only on evidence the payload itself is bad (a permanent 4xx) or on age (TTL).
- Test a poison item followed by healthy items: assert the healthy ones dequeue, the poison one
  stays, and no toast fires. A test with only one queued item cannot see head-of-line blocking.
- When a fix changes "evict" to "keep", ask what the drain does on the *next* item.

## Related Files

- `client/lib/offline-queue-drain.ts` — `TRANSIENT_4XX`, `DrainOutcome`, `attemptDrain`, `drainQueue`
- `client/lib/offline-queue.ts` — `QUEUE_TTL_MS` (the age backstop)
- `client/App.tsx` — foreground drain via `focusManager.subscribe`
- `client/lib/__tests__/offline-queue-drain.test.ts` — the 3×503 halt case and the poison-500 case

## See Also

- [Separate server-attempt counter for offline drain](../design-patterns/separate-server-attempt-counter-for-offline-drain-2026-06-12.md) — the budget this classification sits on top of
- [Offline persistence reliability gotchas](../best-practices/offline-persistence-reliability-gotchas-2026-06-19.md) — cold-start drain, persist allowlist, and the enqueue durability contract
- [Offline replay stamps a write with sync time](offline-replay-stamps-write-with-sync-time-not-occurred-time-2026-10-30.md) — the other half of "a replayed write must mean what the user did"
