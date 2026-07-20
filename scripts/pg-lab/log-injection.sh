#!/usr/bin/env bash
# scripts/pg-lab/log-injection.sh — append-only usage telemetry for inject-patterns.sh
# (PreToolUse) and session-recent-issues.sh (SessionStart), backed by the ocrecipes_lab lab
# DB (harness.injection_log — see scripts/pg-lab/schema/injection-log.sql).
#
# ALWAYS exits 0 and never writes to stdout: this runs BACKGROUNDED off the caller's hot
# path (the caller redirects both stdout and stderr away and does not wait on this
# process), so a logging failure — DB down, psql missing, malformed input — must never
# surface anywhere and must never be observable in the caller's own output.
#
# Input: one line per (domain, action) record on stdin, fields separated by ASCII Unit
# Separator (0x1F, \x1f) — NOT a tab:
#   session_id<US>tool<US>edited_path<US>domain<US>action<US>payload_bytes<US>doc_paths<US>agent_id
# \x1f, not \t: bash's `read` treats tab (like space/newline) as IFS "whitespace" and
# collapses RUNS of it even when IFS is set to tab alone, silently merging adjacent empty
# fields (verified: two consecutive empty tab-delimited fields vanish, shifting every field
# after them). The session-recent-issues.sh caller has BOTH edited_path and domain empty on
# the same line (a SessionStart digest, not scoped to a file or a domain) — exactly the
# adjacent-empty-fields case that breaks with tab. \x1f never appears in real content and is
# never collapsed by IFS splitting, so it is the only delimiter that is safe here.
# doc_paths is a comma-joined list of repo-relative doc ids (docs/rules/*.md,
# docs/solutions/**/*.md) delivered (or that would have been delivered) for that
# domain/action; empty for a dedup pointer (nothing new delivered this call).
# agent_id is the per-dispatch discriminator from the hook JSON (see
# docs/solutions/conventions/hook-json-agent-id-per-context-window-2026-07-19.md) — empty for
# the top-level context, or for a caller (like session-recent-issues.sh's SessionStart digest)
# that is definitionally always top-level. It is the LAST field: a caller still emitting the
# older 7-field line (no trailing agent_id) parses unaffected — `read` leaves an unspecified
# trailing variable empty, so column alignment for every earlier field is unchanged.
#
# PGCONNECT_TIMEOUT bounds the connection phase — the only phase that can hang against a
# local Postgres (query execution for one INSERT is near-instant) — this is the "hard time
# budget" the caller backgrounds against. No external `timeout`/`gtimeout` binary needed
# (neither is present on stock macOS, and nothing else in this repo's hooks uses one).
#
# Usage: printf '<\x1f-delimited lines>' | scripts/pg-lab/log-injection.sh
set -uo pipefail

export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-2}"
LAB_DATABASE_URL="${LAB_DATABASE_URL:-postgresql://localhost/ocrecipes_lab}"

# Hard safety rail: mirrors init.sh / codify-neardup.sh — this must never write to a real
# app database. Fail-silent (exit 0) since this script is never invoked by a human
# directly; the stderr line is only useful when someone runs it manually to debug. Strip
# query string / fragment BEFORE the last-path-segment split — a raw `${VAR##*/}` split
# alone lets a suffix like `?sslmode=require` smuggle a denylisted name (e.g.
# `nutricam?sslmode=require`) past the `case` match entirely, while `psql` itself parses
# the full URI correctly and connects to the real database anyway.
LAB_DB_PATH="${LAB_DATABASE_URL%%\?*}"
LAB_DB_PATH="${LAB_DB_PATH%%\#*}"
case "${LAB_DB_PATH##*/}" in
  nutricam | ocrecipes_solutions)
    echo "log-injection.sh: refusing — LAB_DATABASE_URL resolves to '${LAB_DB_PATH##*/}', a real app database, not a PG Lab database" >&2
    exit 0
    ;;
esac

command -v psql >/dev/null 2>&1 || exit 0

# `|| [ -n "$session_id" ]` is the standard fix for a final line with no trailing newline:
# `read` returns non-zero at EOF-without-newline even though it DID populate the variables,
# which would otherwise silently skip the loop body for a single-line, no-trailing-newline
# caller (verified empirically — a caller that forgets the trailing newline on its one and
# only record loses that record with no error anywhere, since this script never prints to
# stdout and always exits 0).
while IFS=$'\x1f' read -r session_id tool edited_path domain action payload_bytes doc_paths agent_id || [ -n "$session_id" ]; do
  [ -n "$domain" ] || [ -n "$action" ] || continue

  # Build a Postgres text[] literal from the comma-joined doc_paths (empty -> '{}').
  # Individual doc ids never contain commas (repo-relative file paths), so a plain split on
  # ',' is sufficient. Each element is escaped per Postgres array-literal grammar: backslash
  # first, then double-quote, both backslash-escaped (NOT doubled — array-literal quoting is
  # not the same as CSV/SQL-string-literal quoting; doubling a quote here produces a
  # malformed array literal, which fails the whole INSERT silently under `|| true`).
  docs_pg='{}'
  if [ -n "$doc_paths" ]; then
    docs_pg="{$(printf '%s' "$doc_paths" | awk -F',' '{
      out = ""
      for (i = 1; i <= NF; i++) {
        v = $i
        gsub(/\\/, "\\\\", v)
        gsub(/"/, "\\\"", v)
        out = out (i > 1 ? "," : "") "\"" v "\""
      }
      print out
    }')}"
  fi

  bytes="${payload_bytes:-0}"
  case "$bytes" in ''|*[!0-9]*) bytes=0 ;; esac

  # NOTE: psql's :'var' substitution only runs on script/stdin/-f input, never on a -c
  # string (docs/solutions/logic-errors/psql-c-flag-skips-var-substitution-2026-07-05.md) —
  # this INSERT must go through stdin via a heredoc, exactly like this.
  psql -X -q -d "$LAB_DATABASE_URL" \
    -v sid="$session_id" -v tool="$tool" -v path="$edited_path" \
    -v dom="$domain" -v act="$action" -v bytes="$bytes" -v docs="$docs_pg" \
    -v aid="$agent_id" \
    >/dev/null 2>&1 <<'SQL' || true
INSERT INTO harness.injection_log (session_id, tool, edited_path, domain, doc_paths, action, payload_bytes, agent_id)
VALUES (:'sid', :'tool', :'path', :'dom', :'docs'::text[], :'act', :bytes, :'aid');
SQL
done

exit 0
