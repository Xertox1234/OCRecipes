---
title: 'psql -c does not interpolate :''var'' substitution — only script/stdin/-f input does'
track: bug
category: logic-errors
module: shared
severity: critical
tags: [postgres, psql, sql, shell, variable-substitution, silent-failure, pg-lab, sql-injection, input-validation]
symptoms: ['A `psql -v foo=bar -c "SELECT :''foo''"` call fails with `ERROR: syntax error at or near ":"`', The identical `:''var''`/`:var` syntax works fine when piped through stdin/a heredoc or `-f file.sql`, A logging or best-effort INSERT wrapped in `|| true` never populates its target table, with no error surfaced anywhere, 'An unquoted `:var` substitution used in a numeric/boolean SQL context (e.g. `col >= :limit`) executes an attacker-controlled non-integer value as literal SQL text, rewriting the WHERE clause or running a stacked statement', A CLI flag documented as accepting a number is never validated as one before being passed to `-v`]
applies_to: [scripts/pg-lab/**/*.sh]
created: '2026-07-05'
last_updated: '2026-07-06'
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

**2026-07-06 addendum — a related but distinct gotcha, found in the SAME pg-lab bash+psql
family:** correctly routing a `:var` through a heredoc (the fix above) does not by itself
make the substitution safe. `scripts/pg-lab/git-mine.sh`'s `coupled <path> --min-support N`
CLI flag was passed straight into `-v minsup="$min_support"` and referenced **unquoted** —
`AND cc.support >= :minsup` — with no validation that the flag's value was actually a
number. `--min-support "0; INSERT INTO canary VALUES (1)"` executed a stacked `INSERT`
against a scratch DB; `--min-support "5 OR TRUE"` silently rewrote the WHERE clause and
returned every row regardless of the requested threshold. Two independent code reviews
caught this before merge; fixed by validating the flag as a strict non-negative integer
BEFORE it ever reaches `-v`.

## Symptoms

- `psql -v foo=bar -c "SELECT :'foo'"` fails with `ERROR: syntax error at or near ":"`.
- The identical substitution works when piped through stdin (a heredoc,
  `psql -v foo=bar <<'SQL' ... SQL`) or via `-f file.sql`, using the same `:'foo'`/`:foo`
  syntax.
- If the failing `-c` call sits behind a `|| true` (or any other "don't let this block the
  caller" guard), the whole thing fails **silently** — the target table/log simply never
  receives rows, with no error surfaced anywhere.
- A CLI flag meant to be numeric (a `--min-support`/`--limit`/`--threshold`-style value)
  flows straight from `$2` into `-v name="$value"` and is referenced **unquoted** in the
  SQL (`col >= :name`, no surrounding `'`) — with no `[[ "$value" =~ ^[0-9]+$ ]]`-style
  check anywhere before that point.
- A non-numeric or SQL-boolean-shaped value passed to that flag changes query RESULTS
  (more/fewer rows than the stated filter should allow) without psql raising ANY error —
  the query is syntactically valid the whole time, so there is no exception to catch.

## Root Cause

psql's variable interpolation (`:var`, `:'var'`, `:"var"`) is a feature of its
**script/query-file processing** — it runs on input read from stdin, a heredoc, or a `-f`
file. A `-c "<string>"` argument bypasses that processing path entirely, so the literal
colon reaches the server as-is and is a syntax error. This is easy to miss because `-v` and
`-c` are commonly reached for together in ad-hoc one-liners, and nothing in the CLI's
argument parsing warns that combining them is a no-op for substitution.

**The 2026-07-06 addendum's root cause is different and easy to conflate with the above**:
`:'var'` (quoted-literal form) is psql-side-escaped and always safe to use with an
arbitrary string value — but `:var` (bare/unquoted form, required when the value must be a
number or identifier rather than a string literal) performs **raw textual substitution**
with no escaping at all. psql has no concept of a "bound parameter" the way a prepared
statement in an application driver does; both forms are text substitution before the query
is sent, and the bare form provides zero protection. Using the bare form is *correct* SQL
syntax when the target is genuinely numeric (`col >= :limit` needs a bare integer, not a
quoted string) — the vulnerability isn't the bare-substitution mechanism itself, it's
**skipping validation of the shell variable before it reaches `-v`**.

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

**For a bare `:var` substitution** (any numeric/boolean comparison, LIMIT, or similar
non-string context), validate the shell variable as a strict integer (or a fixed enum of
literal SQL keywords, never free text) BEFORE it is ever passed to `-v`:

```bash
# Vulnerable: min_support flows straight from a CLI flag to an unquoted :var
[[ "$min_support" =~ ^[0-9]+$ ]] || {
  echo "expects a non-negative integer — got '$min_support'" >&2
  exit 1
}
psql -v minsup="$min_support" <<'SQL'
SELECT * FROM t WHERE support >= :minsup;
SQL
```

Defense-in-depth on top of the validation: cast the substituted value in SQL
(`:minsup::int`) so a value that somehow slips past the shell-side check still fails as a
clean Postgres type-cast error rather than being executed as arbitrary SQL text.

## Prevention

- Never mix `-v`/`:'var'` with `-c`. A call site that currently uses `-c` and needs a
  variable must be converted to a heredoc/stdin form instead.
- Treat any `psql ... -c "...:'...'..."` in a diff as certain to fail — it cannot work.
- Don't let a `|| true` "best-effort" guard hide this class of error during development:
  run the command once without the guard while implementing, to see the real failure
  before wrapping it defensively.
- Any CLI flag fed into a **bare** (unquoted) `:var` psql substitution MUST be validated
  as a strict integer/enum in bash BEFORE the `psql` call — never assume "it's just a
  number flag, no one will pass anything else." Grep a diff for `-v \w+="\$` followed by a
  bare (non-`'`-wrapped) `:name` reference in the SQL and demand the validation exists.
  String-valued substitutions (`:'var'`) don't need this — psql's own quoting makes them
  safe regardless of content.

## Related Files

- `scripts/pg-lab/codify-neardup.sh` — the value-probe log INSERT (originally written with
  `-c`, fixed to use a heredoc)
- `scripts/pg-lab/git-mine.sh` — `do_coupled`'s `--min-support` (the 2026-07-06 unquoted
  `:minsup` injection, since fixed with an integer-validation guard)
- `.claude/hooks/test-pg-lab-git-mine.sh` — regression test exercising the injection
  payloads that the fix now rejects

## See Also

- [A glob-driven runner loop passes green when the glob matches nothing](glob-runner-loop-fails-open-count-and-fail-on-zero-2026-07-03.md) — same fail-open family: a guard meant to prevent blocking instead hides a real defect
- [pipefail grep condition fails open via SIGPIPE](pipefail-echo-grep-condition-fails-open-via-sigpipe-2026-06-27.md) — another shell fail-open masked by a defensive-looking guard
