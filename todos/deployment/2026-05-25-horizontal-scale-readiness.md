---
title: "Horizontal-scale readiness: move process-local state to a shared store"
status: backlog
priority: medium
created: 2026-05-25
updated: 2026-05-25
assignee:
labels: [architecture, performance, infrastructure]
github_issue:
---

# Horizontal-scale readiness: move process-local state to a shared store

## Summary

The server keeps request-spanning state in the Node process's memory, which
makes it **vertical-scale-only**: you cannot run cluster workers or multiple
instances behind a load balancer without breaking flows or losing cache
coherence. Move that state into a shared store (Redis) so N instances can run
safely.

## Background

Surfaced during VPS capacity scoping (2026-05-25). For ~1000 _active_ users a
single tuned process is likely fine, but any path beyond one core/box is blocked
by process-local state:

- **Photo-analysis workflow session state** lives in process memory
  (`server/storage/sessions.ts`: "upload → optional follow-up → confirm"). It is
  multi-request, so if a follow-up/confirm lands on a different worker than the
  upload, the flow breaks. This is the hard blocker — it breaks correctness, not
  just performance.
- **In-memory TTL caches** become per-worker (lower hit rate / incoherence):
  `server/services/recipe-catalog.ts`, `server/services/verification-streak-cache.ts`,
  `server/services/subscription-tier-cache.ts`.

Together with local-disk image storage (see
`todos/deployment/2026-05-24-r2-image-storage-migration.md`), this is what keeps the app on
a single box today. This todo + the R2 todo are the two prerequisites for true
horizontal scale (Reading B: many simultaneous in-flight requests).

## Acceptance Criteria

- [ ] Photo-analysis session state moved out of process memory (Redis, with TTL) so the upload → follow-up → confirm flow works across instances with **no sticky-session requirement**.
- [ ] In-memory TTL caches backed by Redis — OR a deliberate, documented decision to leave them per-instance with the hit-rate tradeoff accepted.
- [ ] Redis client + env-driven config added; explicit, documented behavior when Redis is unavailable (fail vs degrade).
- [ ] A multi-instance setup (cluster workers or N processes behind nginx) verified to serve the scan flow correctly end-to-end.
- [ ] Cross-check: pool sizing coordinated with `todos/deployment/2026-05-25-pg-pool-max-tuning.md` (total connections across instances < Postgres `max_connections`, or PgBouncer added).

## Dependencies

- A Redis instance (managed or co-located).
- `todos/deployment/2026-05-24-r2-image-storage-migration.md` — required for genuine multi-box (otherwise instances don't share uploaded files).

## Risks

- Redis becomes a new failure dependency — define the degradation story up front (e.g. cache miss → DB; session-store down → reject scan with a clear error).
- Session-state semantics change (TTL/eviction) — must match current in-memory lifetime so confirm-after-delay still works.
- Cache stampede against a cold Redis after deploy/restart.

## Delegation

Not delegable — broad architecture change touching session/workflow state and
the scaling model. Implement via `/todo` with full context, then PR per the
medium-priority flow.

## Updates

### 2026-05-25

- Initial creation from VPS capacity-scoping discussion. Pairs with the R2 image-storage todo as the two horizontal-scale prerequisites.
