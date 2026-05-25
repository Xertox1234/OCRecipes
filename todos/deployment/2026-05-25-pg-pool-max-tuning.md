---
title: "Raise pg connection pool max from default 10 (pre-scale tuning)"
status: backlog
priority: low
created: 2026-05-25
updated: 2026-05-25
assignee:
labels: [deferred, database, performance]
github_issue:
---

# Raise pg connection pool max from default 10 (pre-scale tuning)

## Summary

`server/db.ts` creates the `pg` Pool without a `max`, so it defaults to **10**
connections — a hard ceiling on concurrent DB operations that throttles
throughput well before CPU/RAM are the limit. Make the pool size configurable
and raise the default.

## Background

Surfaced during VPS capacity scoping for ~1000 active concurrent users
(2026-05-25). A pool of 10 means only 10 queries run at once regardless of how
big the box is, so it is the single cheapest throughput win before launch. `pg`
8.21.0 supports `max` (and `idleTimeoutMillis` / `connectionTimeoutMillis`) as
standard `PoolConfig` fields, so this is a one-line-ish change.

This is low-severity _today_ because there is no production traffic yet — it is
pre-scale tuning, not a live defect.

## Acceptance Criteria

- [ ] `server/db.ts` Pool sets `max` from an env var (e.g. `PG_POOL_MAX`) with a sane default (~20–50).
- [ ] Also set `idleTimeoutMillis` and `connectionTimeoutMillis` to sensible values so a saturated pool fails fast instead of hanging.
- [ ] Chosen default documented in CLAUDE.md env section, with a note that pool size must stay under Postgres `max_connections`.

## Implementation Notes

- Current code: `server/db.ts:14` — `new Pool({ connectionString, options })`, no `max` → defaults to 10.
- **Single process:** pool of ~50 is safe against the Postgres default `max_connections` of 100.
- **Multiple instances / cluster workers:** total connections = instances × pool max. Keep the sum under Postgres `max_connections`, or front the DB with PgBouncer. Coordinate this value with the horizontal-scale-readiness work (`todos/deployment/2026-05-25-horizontal-scale-readiness.md`).
- **Managed Postgres caveat:** Neon/Supabase impose their own connection ceilings (pooled vs direct endpoints); size `PG_POOL_MAX` to the chosen provider's limit if the DB is offloaded.

## Risks

- Setting `max` above Postgres `max_connections` → intermittent "too many clients already" errors under load. Validate the two values agree for the target deployment.

## Updates

### 2026-05-25

- Initial creation from VPS capacity-scoping discussion.
