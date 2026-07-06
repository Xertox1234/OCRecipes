---
title: A database-name denylist parsed by naive string-slicing is bypassed by a connection-string query string
track: bug
category: logic-errors
module: server
severity: high
tags: [postgres, connection-string, denylist, security, url-parsing, pg-lab]
symptoms: ['A "must never resolve to a real app database" refusal check compares an exact string like `dbName === "nutricam"`, but the check is built by slicing everything after the last `/` in a connection string', 'A `LAB_DATABASE_URL`/`DATABASE_URL`-style value with a trailing query string (e.g. `postgresql://host/nutricam?sslmode=require`) silently passes the check and connects to the real database anyway', 'The bypass is invisible in code review unless someone traces what the sliced string actually evaluates to for a URL carrying query params']
applies_to: [scripts/pg-lab/**/*.sh, server/lib/contract-snapshot.ts]
created: '2026-07-06'
---

# A database-name denylist parsed by naive string-slicing is bypassed by a connection-string query string

## Problem

A safety rail meant to refuse ever connecting to a real app database (`nutricam`,
`ocrecipes_solutions`) from a dev-only lab tool extracted the database name with naive
string-slicing — `connectionString.slice(connectionString.lastIndexOf("/") + 1)` in
TypeScript, `${LAB_DATABASE_URL##*/}` in bash — and then compared the result with exact
string equality (`dbName === "nutricam"` / `case "$DB_NAME" in nutricam)`). A connection
string with a trailing query string, e.g. `postgresql://localhost/nutricam?sslmode=require`
(a routine, common form for managed Postgres providers), slices to
`"nutricam?sslmode=require"` — which fails the equality check and silently bypasses the
denylist, while `psql`/`pg`'s real connection-string parser correctly resolves the database
to `nutricam` regardless of the query string.

## Symptoms

- The denylist's own comment says "must never resolve to a real app database," but the
  extraction logic doesn't parse the connection string the same way the actual database
  driver does.
- A manual test of the denylist with a bare `postgresql://host/nutricam` (no query string)
  passes, giving false confidence — the bypass only shows up when a query string is present.
- The bug is exploitable purely by accident: any environment where the real app's
  connection string legitimately includes `?sslmode=require` or similar (Railway, Heroku,
  Supabase, RDS all commonly emit this) reopens the exact misconfiguration the guard exists
  to prevent, with zero adversarial intent required.

## Root Cause

`lastIndexOf("/")` / `##*/` only strip the path up to the last slash — they know nothing
about URL structure, so a `?query=string` or `#fragment` suffix rides along unstripped. The
denylist's exact-string comparison then compares against a string it was never designed to
handle, and silently loses (fails to match, thus fails to refuse) rather than erroring.
There is no visible signal that the check ran incorrectly — the caller just proceeds as if
the denylist had approved the connection.

## Solution

Parse the database name with an actual URL parser, not string slicing:

```typescript
// Bypassable: "nutricam?sslmode=require" !== "nutricam"
const dbName = connectionString.slice(connectionString.lastIndexOf("/") + 1);

// Correct: new URL(...).pathname ignores the query string / fragment entirely
function parseDbName(connectionString: string): string {
  try {
    return new URL(connectionString).pathname.replace(/^\//, "");
  } catch {
    // Fallback for a connection string the URL parser rejects.
    const withoutQuery = connectionString.split(/[?#]/)[0];
    return withoutQuery.slice(withoutQuery.lastIndexOf("/") + 1);
  }
}
```

In bash, strip the query string with a `%%\?*` parameter expansion **before** extracting
the trailing path segment:

```bash
# Bypassable: ${LAB_DATABASE_URL##*/} alone leaves "nutricam?sslmode=require"
DB_NAME="${LAB_DATABASE_URL%%\?*}"   # strip from the first "?" onward
DB_NAME="${DB_NAME##*/}"              # THEN extract the trailing path segment
case "$DB_NAME" in nutricam | ocrecipes_solutions) exit 1 ;; esac
```

Add a second, independent layer after the exact-match denylist: reject any resolved name
that isn't a safe bare identifier (`^[A-Za-z_][A-Za-z0-9_]*$` in both languages). This
catches variants the exact-match list can't enumerate — including percent-encoding
(`nutr%69cam` decodes to the literal `nutricam` for a real Postgres connection, but the
un-decoded pathname still contains a `%` that the identifier regex rejects).

## Prevention

- Never derive a security-relevant comparison value (a database name, hostname, or any
  other identifier used in an allow/deny check) from a connection string via ad-hoc
  string-slicing. Use the language's real URL parser (`new URL(...)` in TS/JS) or an
  equivalent structured parser; in bash, strip query/fragment characters explicitly before
  taking the trailing path segment.
- Pair an exact-match denylist with an identifier-format allowlist as a second,
  independent layer — the allowlist catches encoding/normalization tricks the denylist's
  finite string list can't anticipate.
- When the same safety pattern is copied across multiple sibling scripts (as here:
  `init.sh`, `codify-neardup.sh`, `contract-diff.sh`, `contract-snapshot.ts` all implement
  the same `nutricam`/`ocrecipes_solutions` refusal independently), a fix applied to one
  copy does NOT propagate to the others — audit every copy when the pattern is found
  broken in one, or factor the check into one shared, sourced/imported helper so this
  class of drift can't recur.

## Related Files

- `server/lib/contract-snapshot.ts` — `parseDbName()` / `getLabPool()`, fixed
- `scripts/pg-lab/contract-diff.sh` — bash `%%\?*` + `##*/` sequence, fixed
- `scripts/pg-lab/init.sh` — already had the identifier-regex second layer (line ~41),
  which incidentally protected it from this exact bypass before this fix existed
  elsewhere
- `scripts/pg-lab/codify-neardup.sh` — **NOT fixed**; has the identical naive
  `${LAB_DATABASE_URL##*/}` denylist with no identifier-regex second layer, so the same
  query-string bypass is still live there as of this writing (out of scope of the PR that
  discovered it — a different, already-merged PG Lab item's script)

## See Also

- [Lazy-initialize DB pools and API clients in modules that tests import](../conventions/lazy-init-db-pool-and-api-client-in-test-imported-modules-2026-06-13.md) — the sibling convention this same module (`contract-snapshot.ts`) also follows
- [psql -c does not interpolate :'var' substitution](psql-c-flag-skips-var-substitution-2026-07-05.md) — another PG Lab shell-scripting gotcha in the same `scripts/pg-lab/` family
