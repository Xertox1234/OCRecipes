<!-- Filename: P{0-3}-YYYY-MM-DD-short-description.md  (P0=critical … P3=low) -->

---

title: "Boot env aggregation (DATABASE_URL preempts validateEnv) + auth.ts handleRouteError drift"
status: done
priority: low
created: 2026-06-10
updated: 2026-06-10
assignee:
labels: [deferred, architecture, api]
github_issue:

---

# Boot fail-fast ordering + auth.ts error-handling drift

## Summary

Two deferred architecture findings from the 2026-06-10 full audit (L16, L17):
`server/db.ts` throws at module import on missing DATABASE_URL before
`validateEnv()` can produce its aggregated all-missing-vars report; three
`server/routes/auth.ts` catch blocks bypass `handleRouteError`.

## Background

- **L16:** `server/index.ts:9` statically imports `pool` from `./db`, whose
  module body throws on missing DATABASE_URL — so env.ts's documented
  "lists ALL missing required vars" contract can never include DATABASE_URL,
  and an operator missing two vars discovers them one redeploy at a time.
  Still fails fast (correct for Railway), so operator-UX only.
- **L17:** auth.ts logout (161-163), avatar upload (~317-324), avatar delete
  (~353-360) use manual `logger.error` + `sendError(500)` instead of
  `handleRouteError` (docs/rules/api.md rule 1). Research note: `/api/auth/me`'s
  bare async handler is CORRECT per Express 5 docs (automatic rejected-promise
  forwarding) — but it returns the generic error envelope, not the `sendError`
  shape; decide whether to normalize.

## Acceptance Criteria

- [x] DATABASE_URL missing + JWT_SECRET missing → single boot error listing both (e.g. lazy pool init or move validateEnv before the db import)
- [x] The 3 auth.ts catch blocks route through `handleRouteError`
- [x] Decide + document the `/api/auth/me` envelope question

## Implementation Notes

- db.ts laziness must not break the ~30 modules importing `db`/`pool` at module scope — consider a thin getter or import-order fix in index.ts instead.

## Dependencies

- None.

## Risks

- Boot-path changes need a careful smoke test (dev + Railway).

## Updates

### 2026-06-10

- Initial creation — deferred from 2026-06-10 full audit (L16, L17).

### 2026-06-10 (implementation)

- **L16:** Added `server/lib/env-boot.ts` — a side-effect module (`dotenv/config` + `validateEnv()`) imported as the FIRST declaration in `server/index.ts`. A `validateEnv()` body call can never beat `./db` (ESM import hoisting; `./db` is also reached transitively via `./routes` → storage), but import declarations evaluate in order relative to each other, so the bootstrap wins in both tsx/CJS dev and esbuild/ESM prod. `server/db.ts` keeps its own throw as defense-in-depth for direct-entry scripts (`server/scripts/*`, seeds) that never load index.ts.
- **L17:** logout / avatar upload / avatar delete catch blocks now route through `handleRouteError` (contexts `"logout"`, `"upload avatar"`, `"delete avatar"` — response messages unchanged). None of the three try bodies can throw a request-`ZodError`, so the 400 remap arm is inert here.
- **`/api/auth/me` envelope decision: normalize.** Wrapped the bare async handler in try/catch + `handleRouteError(res, error, "fetch current user")`. The bare form was functionally correct (Express 5 auto-forwards rejected promises), but the global handler's 500 envelope (`{ error: "Internal Server Error" }`) lacks the `code` field of the project-standard `sendError` shape, and every other handler in auth.ts already uses try/catch. Decision documented in a code comment at the handler.
- Tests: aggregated missing-vars case added to `server/lib/__tests__/env.test.ts`; new `server/lib/__tests__/env-boot.test.ts` (mocks `dotenv/config` so the repo `.env` can't repopulate cleared vars).
