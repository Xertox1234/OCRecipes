---
title: Importing a DB-free storage leaf (storage/sessions) by its own path is deliberate — routing it through the storage facade pulls in db.ts
track: knowledge
category: conventions
module: server
severity: low
tags: [architecture, storage-facade, import-graph, database-url, testing, false-positive]
applies_to: [server/services/**/*.ts, server/storage/sessions.ts, server/storage/index.ts]
created: '2026-11-06'
---

# A deep import of a DB-free storage leaf is deliberate

## Rule

Don't "fix" an import of `../storage/sessions` (or any other storage sub-module whose runtime imports are only `crypto`, `@shared/` types, or nothing) by routing it through the `storage` facade. The facade, `server/storage/index.ts`, imports every storage module, so it pulls in `server/db.ts`. Before reporting a facade bypass as a layering finding, read the bypassed module's own imports.

## Why

In the 2026-11-06 architecture audit, a reviewer flagged `server/services/coach-warm-up.ts` for importing `warmUpStore` from `../storage/sessions` as a facade bypass. That was L7, marked false-positive:
- `sessions.ts` is an in-memory module with no database import.
- `coach-warm-up.test.ts` imports the service without mocking the database.
- The route tests (`photos`, `cooking`, `verification`) deep-import sessions for the same reason.

Through the facade, those imports would reach `db.ts`, and a CI job with no `DATABASE_URL` would fail at import time.

## Examples

- Keep: `import { warmUpStore, WARM_UP_TTL_MS } from "../storage/sessions";`
- Check first: `grep -n "^import" server/storage/sessions.ts`. Only `crypto` and `import type` lines means a DB-free leaf, so the deep import stays.

## Related Files

- `server/services/coach-warm-up.ts`, `server/storage/sessions.ts`, `server/storage/index.ts`

## See Also

- `docs/solutions/runtime-errors/ci-job-without-database-url-cannot-import-db-ts-2026-11-06.md`
