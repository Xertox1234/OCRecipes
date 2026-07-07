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
last_updated: '2026-07-07'
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

### Residual Gap: Query-Parameter Override and Percent-Encoding

A security-auditor code review (2026-07-07, live-verified against a real local Postgres
instance) confirmed that the bash `%%\?*` + `##*/` strip-then-match fix documented above
**does not close** two further bypass vectors that libpq resolves differently than a bash
string match:

1. **`?dbname=` query-parameter override** — e.g.
   `postgresql://localhost/ocrecipes_lab?dbname=nutricam` strips to the safe-looking
   `ocrecipes_lab` under the documented fix and sails through both the exact-match denylist
   and the identifier-format allowlist, but libpq's own connection-string parser honors the
   `dbname` query parameter over the URI path segment and connects to the real `nutricam`
   database anyway.

2. **Percent-encoding** — e.g.
   `postgresql://localhost/nutr%69cam` strips to `nutr%69cam`, which fails both the
   exact-match denylist and the identifier-format allowlist (it contains a literal `%`),
   yet libpq percent-decodes `%69` to `i` before connecting, resolving to the real
   `nutricam` database.

Both were confirmed via live `psql` probes — the server emitted a 'database does not exist'
FATAL error naming the **actual resolved database name**, proving that what the guard's
bash string ops saw was not what `psql` actually connected to.

**These two vectors are not closable by string-slicing harder.** The robust fix is to
stop hand-parsing the URI in bash entirely and ask `psql` for ground truth instead:

```bash
ACTUAL_DB=$(psql -X -tAqd "$LAB_DATABASE_URL" -c 'SELECT current_database()' 2>/dev/null)
```

then denylist-match `$ACTUAL_DB`, not any bash-derived substring. This approach naturally
defeats both `dbname=` overrides and percent-encoding because `psql` connects using
libpq's full parser and then reports the database it actually connected to.

> ⚠️ **This remains an OPEN, unfixed gap** across every script in the `scripts/pg-lab/*.sh`
> family, including those this document's earlier sections mark as already fixed for the
> simpler query-string/fragment bypass. The query-param-override and percent-encoding
> vectors are unaddressed everywhere as of 2026-07-07.

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
- **For bash scripts specifically**, the only reliable defense against all URI-based
  bypasses (query string suffix, `?dbname=` override, percent-encoding, and any future
  libpq peculiarity) is to delegate the connection to `psql` and inspect the actual
  resolved database name via `current_database()` after the connection succeeds. This is
  more expensive (requires a live connection attempt) but guarantees the guard matches
  what the driver will actually use.

## Related Files

- `server/lib/contract-snapshot.ts` — `parseDbName()` / `getLabPool()`, fixed for
  query-string/fragment bypass; **still vulnerable to `?dbname=` override and
  percent-encoding**, though the TypeScript `new URL()` path does not strip query
  parameters beyond the pathname, so the identifier-regex second layer would reject
  `dbname` overrides if they are passed as path components (but not if they are query
  parameters that libpq reads separately). As of 2026-07-07, this file is not known to be
  exploitable because the `?dbname=` parameter is not automatically injected by the
  library the TypeScript code uses (`pg`), but the guard is not robust against future
  changes.
- `scripts/pg-lab/contract-diff.sh` — bash `%%\?*` + `##*/` sequence strips the query
  string only; it does **not** also strip a trailing `#fragment` (unlike the other fixed
  siblings below), so the fragment-suffix bypass is still live there as of 2026-07-07;
  **also vulnerable to `?dbname=` override and percent-encoding**.
- `scripts/pg-lab/init.sh` — fixed for query-string/fragment (via the `LAB_DB_PATH` strip
  pattern) and already had the identifier-regex second layer (line ~41) independently.
  However, the identifier-regex allowlist does **not** protect against `?dbname=`
  overrides because the query-parameter value is never seen by the bash path extraction;
  **still vulnerable to that vector** (and to percent-encoding, though the allowlist would
  reject `%`-containing strings, so percent-encoding of a bare identifier in the path is
  blocked — but a percent-encoded `dbname=` parameter value would still be hidden from the
  bash check entirely).
- `scripts/pg-lab/codify-neardup.sh` — **fixed** for query-string/fragment bypass (via the
  identical `LAB_DB_PATH` strip pattern); **still vulnerable to `?dbname=` override and
  percent-encoding**.
- `scripts/pg-lab/injection-report.sh` — **now fixed** for query-string/fragment bypass
  (via the identical `LAB_DB_PATH` strip pattern added 2026-07-07); **still vulnerable to
  `?dbname=` override and percent-encoding**.
- `scripts/pg-lab/log-injection.sh`, `scripts/pg-lab/eval-report.sh`,
  `scripts/pg-lab/flake-report.sh`, `scripts/pg-lab/git-mine.sh` — also fixed for
  query-string/fragment via the identical `LAB_DB_PATH` pattern; **still vulnerable to
  `?dbname=` override and percent-encoding**.
- `scripts/pg-lab/api-cache-report.sh`, `scripts/pg-lab/symbol-graph.sh`,
  `scripts/pg-lab/transcripts.sh` — **NOT fixed** even for the simpler query-string/fragment
  bypass; still use the naive `${LAB_DATABASE_URL##*/}` alone (out of scope of the PR that
  discovered this, per todos/archive/P3-2026-07-06-pg-lab-safety-rail-query-string-bypass.md).

## See Also

- [Lazy-initialize DB pools and API clients in modules that tests import](../conventions/lazy-init-db-pool-and-api-client-in-test-imported-modules-2026-06-13.md) — the sibling convention this same module (`contract-snapshot.ts`) also follows
- [psql -c does not interpolate :'var' substitution](psql-c-flag-skips-var-substitution-2026-07-05.md) — another PG Lab shell-scripting gotcha in the same `scripts/pg-lab/` family