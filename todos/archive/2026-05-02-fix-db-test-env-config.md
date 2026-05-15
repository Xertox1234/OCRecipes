---
title: "Fix DB integration tests not picking up DATABASE_URL from .env"
status: done
priority: low
created: 2026-05-02
updated: 2026-05-02
assignee:
labels: [testing, database, deferred]
---

# Fix DB integration tests not picking up DATABASE_URL from .env

## Summary

The 14 `server/storage/__tests__/` test files fail locally because the test runner doesn't load `DATABASE_URL` from `.env`, causing it to fall back to a default connection using the OS username (`williamtower`) as the database name, which doesn't exist.

## Background

Discovered during the `feat/quicklog-drawer` branch wrap-up. PostgreSQL 18 is running and the `nutricam` database exists, but running `npm run test:run` without explicitly passing `DATABASE_URL` produces:

```
error: database "williamtower" does not exist
```

Workaround: run DB tests manually with:

```bash
DATABASE_URL=postgresql://localhost/nutricam npm run test:run -- server/storage/__tests__/
```

The 291 non-DB unit test files (3,898 tests) all pass correctly. The issue is isolated to DB integration tests.

## Acceptance Criteria

- [ ] `npm run test:run` passes all 305 test files without requiring manual `DATABASE_URL` prefix
- [ ] DB integration tests connect to `nutricam` automatically in the local dev environment
- [ ] CI/CD environment is unaffected (it sets `DATABASE_URL` explicitly)

## Implementation Notes

Likely fix: ensure Vitest loads `.env` before running tests. Check `vite.config.ts` or `vitest.config.ts` for `envFile` / `dotenv` config. Vitest supports `envFile` option or can use `dotenv` via a setup file. Alternatively, add a `test:db` script to `package.json` that prepends the env var.

Also worth checking: does `test/db-test-utils.ts` call `getPool()` before `.env` is loaded? A setup file that loads `dotenv` early may be all that's needed.

## Dependencies

- None

## Risks

- Changing Vitest env loading could affect other tests that mock env vars — verify no regressions

## Updates

### 2026-05-02

- Initial creation; deferred during quicklog-drawer feature work

### 2026-05-03

- Verified fix already applied: `import "dotenv/config"` was added to `test/setup.ts` in commit `ce8abed4` (2026-02-27) as part of the storage integration test infrastructure.
- All 307 test files (4282 tests) pass with `npm run test:run` without requiring `DATABASE_URL` prefix when run from project root.
- No code changes needed; archiving as resolved.
