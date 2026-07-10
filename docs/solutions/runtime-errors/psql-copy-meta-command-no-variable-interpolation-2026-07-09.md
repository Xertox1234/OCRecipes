---
title: psql \copy performs NO variable interpolation — :'var' reaches the server raw
track: bug
category: runtime-errors
module: shared
severity: medium
tags: [postgres, psql, bash, copy, meta-command, variable-substitution, pg-lab, csv-export]
applies_to: ["scripts/pg-lab/**/*.sh"]
symptoms: ['psql exits 3 with `ERROR: syntax error at or near ":"` pointing at a `:''var''` inside a \copy command', "A \\copy that works with a hardcoded value fails as soon as the WHERE clause is parameterized with -v var=... + :'var'", 'The same :''var'' substitution works fine in plain SELECT/INSERT statements in the same heredoc-fed psql session']
created: '2026-07-09'
---

# psql \copy performs NO variable interpolation — :'var' reaches the server raw

## Problem

A parameterized CSV export in `scripts/pg-lab/distill.sh` used the `\copy` meta-command
with a psql variable in its embedded query:

```bash
sql -v sid="$sid" <<SQL
\\copy (SELECT ... FROM harness.transcript_messages WHERE session_id = :'sid' ...) TO '$rows' (FORMAT csv)
SQL
```

psql exits 3: `ERROR: syntax error at or near ":"`. The `:'sid'` was never substituted —
the server received it verbatim.

## Symptoms

- psql exits 3 with `ERROR: syntax error at or near ":"` pointing into the `\copy` query.
- The identical `:'var'` works in plain SQL statements fed through the same heredoc, so the
  breakage looks statement-specific and mysterious.

## Root Cause

`\copy` is documented as the exception among meta-commands: *the entire remainder of the
line is taken literally — neither variable interpolation nor backquote expansion are
performed in its arguments*. So `-v sid=... ` + `:'sid'` — the repo-standard heredoc
substitution pattern (see the psql `-c` gotcha doc in See Also) — silently does not apply
inside a `\copy` line, and the raw `:'sid'` reaches the server as SQL.

## Solution

Use server-side `COPY ... TO STDOUT` in a **plain SQL statement** (full variable
interpolation applies) and let psql's stdout redirect do the client-side file write:

```bash
sql -v sid="$sid" <<'SQL' > "$rows"
COPY (SELECT msg_uuid, role, content FROM harness.transcript_messages
      WHERE session_id = :'sid' AND role IN ('user','assistant')
      ORDER BY ts NULLS LAST, msg_uuid) TO STDOUT (FORMAT csv);
SQL
```

`TO STDOUT` needs no server file access (no superuser requirement — that only applies to
server-side file `COPY`), and the heredoc can be quoted since nothing needs bash expansion.
For the import direction, `\copy table FROM '$file'` remains fine when the path is
bash-expanded and no psql variables appear on the line (the `transcripts.sh` pattern).

## Prevention

- Any psql variable (`:var`, `:'var'`, `:"var"`) on a `\copy` line is a bug — psql will not
  substitute it. Parameterize via server-side `COPY ... TO STDOUT` / `FROM STDIN` in plain
  SQL, or bash-expand the value into the line (only for trusted, non-SQL fragments like
  file paths).
- The distinction is per-meta-command: most meta-commands DO interpolate their arguments;
  `\copy` alone takes its line literally.

## Related Files

- `scripts/pg-lab/distill.sh` — `assemble_session` (the COPY TO STDOUT form)
- `scripts/pg-lab/transcripts.sh` — `\copy ... FROM '$tmp_csv'` (bash-expanded path form)

## See Also

- [psql -c does not interpolate :'var' substitution](../logic-errors/psql-c-flag-skips-var-substitution-2026-07-05.md) — the sibling substitution gotcha; together: `-c` and `\copy` are the two places the heredoc `:'var'` pattern silently stops working
