---
title: 'Bash `${VAR##*/}` database-name denylist checks must strip query string/fragment first'
track: bug
category: logic-errors
module: shared
severity: high
tags: [postgres, bash, shell, denylist, safety-rail, pg-lab, url-parsing, silent-failure]
applies_to: [scripts/pg-lab/**/*.sh]
symptoms: ['A `case "${URL##*/}" in known_db_1 | known_db_2) refuse ;; esac` guard passes for a connection string with a trailing `?query=string` or `#fragment`', The tool actually making the connection (psql, or anything with a real URL parser) connects to the real denylisted database anyway, No error or warning — the script proceeds as if the connection string were safe]
created: '2026-07-06'
last_updated: '2026-07-07'
---

# Bash `${VAR##*/}` database-name denylist checks must strip query string/fragment first

## Problem

`scripts/pg-lab/flake-report.sh` guards against ever running against a real app database
with `case "${LAB_DATABASE_URL##*/}" in nutricam | ocrecipes_solutions) ... esac` — a bash
suffix split that takes everything after the last `/`. Code review caught that
`LAB_DATABASE_URL="postgresql://localhost/nutricam?sslmode=require"` resolves to
`nutricam?sslmode=require`, which matches neither `case` arm, so the refusal is silently
skipped — while `psql` itself parses the full URI correctly and connects to the real
`nutricam` database anyway. The script would then apply schema DDL and run report queries
against a real app database that the check exists specifically to protect.

## Symptoms

- A `case "${URL##*/}" in known_db_1 | known_db_2) refuse ;; esac` guard passes (does not
  refuse) for a connection string with a trailing `?query=string` or `#fragment`, even
  though the path segment is a denylisted name.
- The tool being guarded (`psql`, or anything else that parses the URI properly) connects
  to the real, denylisted database anyway — the guard and the actual connection disagree
  about what database the same string points to.
- No error, no warning — the script simply proceeds as if the connection string were safe.

## Root Cause

`${VAR##*/}` is a pure string operation: "delete the longest match of `*/ ` from the
front," with no awareness of URI structure. A connection string's last path segment can be
followed by a query string (`?key=value`) or a fragment (`#frag`), both of which become
part of what `${VAR##*/}` returns verbatim. `psql` (and any real URL parser, including
JavaScript's `new URL(...).pathname`) correctly separates the path from the query/fragment
and resolves the actual database name — so the shell-side denylist and the tool actually
making the connection can disagree on a string that contains `?` or `#` after the database
name, defeating the check for exactly the strings a URL parser would still catch.

## Solution

Strip the query string and fragment before taking the last path segment:

```bash
# Strip any query string / fragment BEFORE the last-path-segment split — a raw
# ${VAR##*/} split alone lets a suffix like `?sslmode=require` smuggle a denylisted name
# (e.g. `nutricam?sslmode=require`) past the case match entirely.
DB_PATH="${LAB_DATABASE_URL%%\?*}"
DB_PATH="${DB_PATH%%\#*}"
case "${DB_PATH##*/}" in
  nutricam | ocrecipes_solutions)
    echo "refusing — resolves to a real app database" >&2
    exit 1
    ;;
esac
```

`${VAR%%\?*}` deletes the longest match of `?*` from the back (everything from the first
`?` onward); `${VAR%%\#*}` does the same for `#`. Applying both, in that order, before the
`##*/` suffix split reproduces what a real URL parser's `.pathname` would give for the
common `postgresql://host[:port]/dbname[?query][#fragment]` shape this project's PG Lab
scripts always use.

In a TypeScript writer (not a bash script), prefer `new URL(connectionString).pathname`
directly — it's the same fix, expressed with an actual URL parser instead of string
surgery, and is the pattern this project's PG Lab TypeScript writers already use.

## Prevention

Any bash script that denylists a database (or host, or any other URL component) by
string-matching a raw suffix split must strip query string and fragment first, or use a
real parser (`node -e "console.log(new URL(process.argv[1]).pathname)" -- "$URL"`) instead
of shell string surgery. Treat "match a URL component with `${VAR##*/}`/`${VAR%%pattern}`
alone" as suspect in review — the fix above is 2 lines and cheap to apply everywhere this
pattern recurs.

**Update 2026-07-07:** all three scripts below are now fixed — `init.sh` and
`codify-neardup.sh` in PR #538 (2026-07-06), `eval-report.sh` in the sibling PR mentioned
above. See the companion doc linked in See Also for the current per-script fix matrix
across the full `scripts/pg-lab/*.sh` family, including a residual `?dbname=`
query-parameter-override gap this simpler fix does not close.

~~Known instances of this same unfixed pattern in this codebase as of 2026-07-06~~ (found
during review of this fix, out of scope for the PR that fixed `flake-report.sh` — resolved,
see update above):

- ~~`scripts/pg-lab/init.sh`~~ fixed
- ~~`scripts/pg-lab/codify-neardup.sh`~~ fixed
- ~~`scripts/pg-lab/eval-report.sh`~~ fixed

## Related Files

- `scripts/pg-lab/flake-report.sh` — the instance this was found in and fixed

## See Also

- [A database-name denylist parsed by naive string-slicing is bypassed by a connection-string query string](denylist-bypassed-by-connection-string-query-string-2026-07-06.md) — the same bug family, independently discovered the same day via `codify-neardup.sh`/`injection-report.sh`; has the current per-script fix matrix, the residual `?dbname=`-override gap, and a libpq-behavior nuance (`#` is a literal dbname character in connection strings, not a fragment delimiter)
- [Buffer-then-flush writers must chunk multi-row INSERTs](../runtime-errors/postgres-bind-parameter-limit-buffered-multirow-insert-2026-07-06.md) — found in the same review pass, a different PG Lab safety gap
- [psql -c does not interpolate :'var' substitution](psql-c-flag-skips-var-substitution-2026-07-05.md) — another shell-string-handling gotcha specific to this same `scripts/pg-lab/*.sh` family
