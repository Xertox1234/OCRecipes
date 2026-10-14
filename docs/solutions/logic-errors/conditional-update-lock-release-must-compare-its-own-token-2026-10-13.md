---
title: A conditional-UPDATE lock with stale takeover must hand its holder a token, and release only where that token still matches — or a displaced holder's cleanup frees the new holder's lock
track: bug
category: logic-errors
module: server
severity: medium
tags: [database, api, concurrency, locks, idempotency]
symptoms: [Two "Make this mine" generations run for one card despite the single-make lock, A request that stalled past the stale window and then failed clears a lock a newer request holds, A third request starts while the second is still generating]
applies_to: [server/storage/**/*.ts, server/routes/**/*.ts]
created: '2026-10-13'
---

# A conditional-UPDATE lock with stale takeover must release only its own token

## Problem

"Make this mine" must run one AI generation per card. The lock is a timestamp column on the row:

```sql
UPDATE inspired_suggestions SET making_started_at = now()
WHERE id = $1 AND user_id = $2 AND made_recipe_id IS NULL
  AND (making_started_at IS NULL OR making_started_at <= now() - interval '2 min')
RETURNING id
```

A stale window lets a crashed request's lock be retaken. The first release looked like this:

```ts
abandonMakingSuggestion(id) // SET making_started_at = NULL WHERE id = $1
```

Sequence:
1. Request A takes the lock and stalls past the 2-minute window.
2. Request B retakes the lock and starts generating.
3. A's generation fails, and its cleanup calls `abandon(id)`. That wipes **B's** lock.
4. Request C now takes the lock while B is still generating. Two generations run, and the daily quota is spent twice.

## Symptoms

See frontmatter.

## Root Cause

Once a stale takeover exists, the row's lock column belongs to whoever last wrote it, not to whoever is releasing it. A release keyed only on the row id can't tell "my lock" from "the lock that replaced mine".

## Solution

Return the value you wrote as a **token**, and release only where it still matches:

```ts
startMakingSuggestion(userId, id, staleAfterMs): Promise<Date | null>
// … .set({ makingStartedAt: now }).where(…).returning({ t: makingStartedAt }) → token or null

abandonMakingSuggestion(id, startedAt: Date)
// WHERE id = $1 AND making_started_at = $startedAt AND made_recipe_id IS NULL
```

- **Release on every failure path:** in the route, release in a `finally` guarded by a `settled` flag. Set `settled` only after the claim (`made_recipe_id = …`) returns, so every throw, and the limit-reached `null`, releases the lock.
- **Precision:** a JS `Date` has millisecond precision, so it round-trips exactly through `timestamptz`, which stores microseconds. Prove it with a test where the **correct** holder's release does clear the lock, otherwise a release that never matches passes silently.
- **Everything that touches the row must respect a live lock:**
  - The expiry purge must skip rows whose lock is live (`making_started_at IS NULL OR <= now − stale`).
  - The background photo writer must refuse to write to a row while a make is in flight.

## Prevention

- Review rule: in any "conditional UPDATE … RETURNING" lock with a stale window, check the release statement's WHERE clause for the holder's token.
- Tests:
  - A displaced holder's release leaves the new lock in place.
  - The correct holder's release clears it.
  - A made row can't be locked again.

## Related Files

- `server/storage/inspired-suggestions.ts` — `startMakingSuggestion`, `abandonMakingSuggestion`, `noLiveMakeLock`
- `server/routes/inspired-recipes.ts` — make route's `settled` + `finally`
- `shared/schemas/inspired-recipes.ts` — `MAKING_STALE_MS`

## See Also

- [mark-then-enrich-orphan-state-window](mark-then-enrich-orphan-state-window-2026-05-13.md) — the related "state set before work finishes" window
- [delete-rows-before-blobs](../design-patterns/delete-db-rows-before-blobs-and-respect-in-flight-work-2026-10-13.md) — the purge side of the same lock
