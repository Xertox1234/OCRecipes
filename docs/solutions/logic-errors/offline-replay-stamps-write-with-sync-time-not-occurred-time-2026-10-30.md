---
title: "An offline-replayed write is stamped with the replay time unless the client sends when it happened — send X-Queued-At from the drain and accept it server-side only in a bounded window"
track: bug
category: logic-errors
module: shared
tags: [api, client-state, offline-queue, timestamp, timezone, data-integrity, daily-log]
applies_to: [client/lib/offline-queue-drain.ts, server/routes/nutrition.ts, server/storage/nutrition.ts]
symptoms: ["A meal logged offline late at night shows up on the next day's log after it syncs", "Yesterday's daily totals are short and today's are inflated after reconnecting", "scannedAt / loggedAt equals the moment the phone got signal, not the moment the user logged"]
created: '2026-10-30'
severity: medium
---

# An offline-replayed write is stamped with the replay time

## Problem

`POST /api/scanned-items` stamped `scannedAt` and the daily log's `loggedAt` with server `now()`.
For an online request that is the moment the user acted. For a write the offline queue replays
up to 24h later, it is the moment the phone got signal — so a meal logged at 11:50pm and synced
next morning lands on the wrong day, and the day-bucketed totals for both days are wrong.

## Symptoms

See frontmatter.

## Root Cause

The server treated "when the request arrived" as "when the event happened". The queue already
recorded the real time (`savedAt`) and never sent it.

## Solution

Put the timestamp at the **drain**, not at each enqueue site — one place covers every queued
endpoint and every item already queued by older builds:

```ts
// client/lib/offline-queue-drain.ts
const headers: Record<string, string> = {
  "X-Queued-At": new Date(current.savedAt).toISOString(),
};
if (current.method === "POST") headers["X-Idempotency-Key"] = current.id;
```

The server accepts it only inside a bounded window (≤ 5 min in the future for clock skew,
≤ 48h old — the 24h queue TTL plus slack) and otherwise falls back to server time. It reaches
storage as an optional override that stamps **both** columns:

```ts
const occurredAt = parseQueuedAt(req.headers["x-queued-at"]); // Date | undefined
await storage.createScannedItemWithLog(input, ...(occurredAt ? [{ occurredAt }] : []));
```

## Prevention

- For any endpoint a durable client queue can replay, ask "does the server stamp a time?" If yes,
  it needs the client's occurred-at.
- A client-supplied timestamp is untrusted input: bound it on both sides, never let it backdate
  arbitrarily (streaks, daily limits and analytics key on it). Out-of-window → ignore, don't 400 —
  the write itself is still valid.
- Endpoints that don't read the header are unaffected, so sending it on every replay is safe.

## Related Files

- `client/lib/offline-queue-drain.ts` — `X-Queued-At` header in `attemptDrain`
- `server/routes/nutrition.ts` — `parseQueuedAt`, `CONSUMED_AT_MAX_AGE_MS`, `CONSUMED_AT_MAX_FUTURE_MS`
- `server/storage/nutrition.ts` — `createScannedItemWithLog` `occurredAt` override
- `server/routes/__tests__/nutrition.test.ts`, `server/storage/__tests__/nutrition.test.ts`

## See Also

- [Offline drain classifies by status meaning](offline-drain-evicts-on-transient-status-and-head-of-line-blocks-2026-10-30.md) — the same drain's eviction rules
- [A Date cannot express a calendar day](a-date-cannot-express-a-calendar-day-2026-08-31.md) — how the stamped instant is then bucketed into a day
