# Audit: Authentication System Security

> **Date:** 2026-04-01
> **Trigger:** Targeted security audit of the authentication system
> **Domains:** security
> **Baseline:** 3219 tests passing (226 files) | 0 type errors | 0 lint errors (10 warnings)

## Findings

Each finding has a lifecycle: `open` → `fixing` → `verified` or `deferred` or `false-positive`.

**Status key:**

- `open` — Found but not yet addressed
- `fixing` — Work in progress
- `verified` — Fix applied AND confirmed by test/grep/type-check
- `deferred` — Intentionally postponed (must link to todo)
- `false-positive` — Agent was wrong or issue was already fixed

### Critical

| ID  | Finding | File(s) | Status | Verification |
| --- | ------- | ------- | ------ | ------------ |
| —   | None    | —       | —      | —            |

### High

| ID  | Finding | File(s) | Status | Verification |
| --- | ------- | ------- | ------ | ------------ |
| —   | None    | —       | —      | —            |

### Medium

| ID  | Finding                                                                                                                                                                                         | File(s)                                   | Status   | Verification                                                                                                                                                                                |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | Non-atomic tokenVersion increment (TOCTOU) — logout reads `user.tokenVersion` then writes `+1` in JS; concurrent logouts can collide. Codebase uses `sql` template atomic increments elsewhere. | `server/routes/auth.ts:161`               | verified | Added `incrementTokenVersion()` with `sql` atomic increment; logout uses it directly. 88/88 auth tests pass.                                                                                |
| M2  | `getUser()`/`getUserByUsername()` return full row including password hash via `SELECT *`. All current routes serialize properly, but no defense-in-depth against future leaks.                  | `server/storage/users.ts:31,39`           | verified | `getUser`/`getUserByUsername` now use `safeUserColumns` (excludes password). Added `getUserForAuth`/`getUserByUsernameForAuth` for login/delete-account. 115/115 tests pass, 0 type errors. |
| M3  | API key cache uses raw key as Map key — plaintext keys in process memory. If memory is dumped, keys leak.                                                                                       | `server/middleware/api-key-auth.ts:39-48` | verified | Cache now uses SHA-256 hash of raw key as Map key via `cacheKey()`. All 4 operations (get/set/invalidate/delete) use hash. 25/25 API key tests pass.                                        |

### Low

| ID  | Finding                                                                                                                                                                   | File(s)                             | Status   | Verification                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| L1  | `jwt.sign()` doesn't set `iss`/`aud` claims and `jwt.verify()` doesn't check them. If JWT_SECRET is accidentally shared with another service, tokens are interchangeable. | `server/middleware/auth.ts:148-150` | verified | Added `JWT_ISSUER`/`JWT_AUDIENCE` constants. Both `jwt.sign()` and `jwt.verify()` now use `issuer`/`audience` options. 88/88 auth tests pass. |

## Deferred Items

Items marked `deferred` must have a linked todo and rationale.

| ID  | Todo | Rationale |
| --- | ---- | --------- |
| —   | —    | —         |

## Summary

| Severity  | Found | Verified | Deferred | False-positive | Open  |
| --------- | ----- | -------- | -------- | -------------- | ----- |
| Critical  | 0     | 0        | 0        | 0              | 0     |
| High      | 0     | 0        | 0        | 0              | 0     |
| Medium    | 3     | 3        | 0        | 0              | 0     |
| Low       | 1     | 1        | 0        | 0              | 0     |
| **Total** | 4     | 4        | 0        | 0              | **0** |

## Fix Commits

| Commit | Description |
| ------ | ----------- |
| —      | —           |

## Codification (Phase 7)

Completed after fixes are committed. Each row links to the docs change.

### Patterns Extracted

| Finding | Pattern                                        | Added To                    |
| ------- | ---------------------------------------------- | --------------------------- |
| M1      | Atomic Counter / Version Increments via SQL    | `docs/patterns/database.md` |
| M2      | Exclude Sensitive Columns from Default Queries | `docs/patterns/security.md` |
| M3      | Hash Secrets Used as In-Memory Cache Keys      | `docs/patterns/security.md` |

### Learnings Extracted

| Finding | Learning Title | Category |
| ------- | -------------- | -------- |
| —       | (none)         | —        |
