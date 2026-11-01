---
title: "The offline queue discards a log on 408/429 or a short 5xx window"
status: done
priority: low
created: 2026-10-29
updated: 2026-10-31
assignee:
labels: [deferred, client, reliability]
github_issue:
---

# The offline queue discards a log on 408/429 or a short 5xx window

## Summary

Draining the offline write queue drops an item on any 4xx — including 408 and 429 — and after about 14 s of 5xx backoff.

## Background

Audit finding L-crel-7. `client/lib/offline-queue-drain.ts` (~117-127), `RETRY_DELAYS_MS` 0/2/4/8 s. A food log made offline and replayed during a deploy or a rate-limit window is lost with a "couldn't be synced" toast. Check against the 2026-06-23 offline-persistence audit before changing.

Found by the 2026-10-29 pre-launch audit (manifest `docs/audits/2026-10-29-pre-launch.md`, local-only); deferred from the unattended overnight run because it needs a decision or verification that run could not make.

## Acceptance Criteria

- [x] 408 and 429 are treated as transient (kept, retried later)
- [x] A 5xx keeps the item for a later drain instead of discarding after ~14 s
- [x] Tests cover 408, 429, 5xx and a genuine 4xx

## Implementation Notes

Respect Retry-After on 429 if present.

## Scope Contract

- **Files in scope:** `client/lib/offline-queue-drain.ts` and its tests
- No new mechanisms, files, or abstractions beyond those listed.

## Updates

### 2026-10-29

- Initial creation (pre-launch audit, overnight run)

### 2026-10-31

- Already fixed on main by the 2026-10-30 reliability audit (R15): `client/lib/offline-queue-drain.ts` `TRANSIENT_4XX` = {401, 408, 425, 429} keeps the item and halts the drain; a 5xx that outlasts the in-drain backoff is `deferred` to the next drain and only discarded past `QUEUE_TTL_MS`. Tests in `client/lib/__tests__/offline-queue-drain.test.ts`. Retry-After is not read: a 429 halts the drain and the next drain retries (owner agreed 2026-10-31 to close). Archived.
