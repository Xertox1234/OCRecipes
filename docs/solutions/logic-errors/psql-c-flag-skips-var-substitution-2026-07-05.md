---
title: 'psql -c does not interpolate :''var'' substitution — only script/stdin/-f input does'
track: bug
category: logic-errors
module: shared
severity: medium
tags: [postgres, psql, sql, shell, variable-substitution, silent-failure, pg-lab]
symptoms: ['A `psql -v foo=bar -c "SELECT :''foo''"` call fails with `ERROR: syntax error at or near ":"`', The identical `:''var''`/`:var` syntax works fine when piped through stdin/a heredoc or `-f file.sql`, A logging or best-effort INSERT wrapped in `|| true` never populates its target table, with no error surfaced anywhere]
applies_to: [scripts/pg-lab/**/*.sh]
created: '2026-07-05'
---

# psql -c does not interpolate :'var' substitution — only script/stdin/-f input does

## Problem

A script built an INSERT using psql's `-v name=value` variable mechanism, referencing it
with the quoted-literal substitution syntax `:'name'`, but passed the SQL via
`-c "INSERT ... VALUES (:'cand', :score)"`. The call raised
`ERROR: syntax error at or near ":"` — but since it was wrapped in `|| true` (a deliberate
"best-effort, never let logging block the caller" guard), the error was swallowed and the
script's own exit code stayed 0. The bug was invisible until a downstream query on the
target table came back unexpectedly empty.

## Symptoms

- `psql -v foo=bar -c "SELECT :'foo'"` fails with `ERROR: syntax error at or near ":"`.
- The identical substitution works when piped through stdin (a heredoc,
  `psql -v foo=bar <<'SQL' ... SQL`) or via `-f file.sql`, using the same `:'foo'`/`:foo`
  syntax.
- If the failing `-c` call sits behind a `|| true` (or any other "don't let this block the
  caller" guard), the whole thing fails **silently** — the target table/log simply never
  receives rows, with no error surfaced anywhere.

## Root Cause

psql's variable interpolation (`:var`, `:'var'`, `:"var"`) is a feature of its
**script/query-file processing** — it runs on input read from stdin, a heredoc, or a `-f`
file. A `-c "<string>"` argument bypasses that processing path entirely, so the literal
colon reaches the server as-is and is a syntax error. This is easy to miss because `-v` and
`-c` are commonly reached for together in ad-hoc one-liners, and nothing in the CLI's
argument parsing warns that combining them is a no-op for substitution.

## Solution

Route any `psql` invocation that needs `:var`/`:'var'` substitution through **stdin (a
heredoc)**, never `-c`:

```bash
# Silently fails -- -c does not run the variable-substitution pass
psql -d "$URL" -v cand="$CANDIDATE" -c "INSERT INTO t (c) VALUES (:'cand')"

# Works -- the SQL is read as a script from stdin
psql -d "$URL" -v cand="$CANDIDATE" <<'SQL'
INSERT INTO t (c) VALUES (:'cand');
SQL
```

If the SQL also needs an actual bash variable interpolated (not a psql `:var`), the
heredoc delimiter must be **unquoted** (`<<PSQL`, not `<<'PSQL'`) so the shell performs its
own substitution before psql ever sees the text — bash's `$var` and psql's `:'var'` can
coexist in the same heredoc as long as the delimiter quoting matches which one you want.

## Prevention

- Never mix `-v`/`:'var'` with `-c`. A call site that currently uses `-c` and needs a
  variable must be converted to a heredoc/stdin form instead.
- Treat any `psql ... -c "...:'...'..."` in a diff as certain to fail — it cannot work.
- Don't let a `|| true` "best-effort" guard hide this class of error during development:
  run the command once without the guard while implementing, to see the real failure
  before wrapping it defensively.

## Related Files

- `scripts/pg-lab/codify-neardup.sh` — the value-probe log INSERT (originally written with
  `-c`, fixed to use a heredoc)

## See Also

- [A glob-driven runner loop passes green when the glob matches nothing](glob-runner-loop-fails-open-count-and-fail-on-zero-2026-07-03.md) — same fail-open family: a guard meant to prevent blocking instead hides a real defect
- [pipefail grep condition fails open via SIGPIPE](pipefail-echo-grep-condition-fails-open-via-sigpipe-2026-06-27.md) — another shell fail-open masked by a defensive-looking guard
