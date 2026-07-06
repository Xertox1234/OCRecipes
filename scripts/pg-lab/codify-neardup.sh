#!/usr/bin/env bash
# scripts/pg-lab/codify-neardup.sh — pg_trgm near-dup advisory for /codify, backed by the
# ocrecipes_lab lab DB (harness.solution_titles, a derived projection of docs/solutions/
# frontmatter — see scripts/pg-lab/schema/codify-neardup.sql).
#
# Two modes:
#   --rebuild            Truncate and repopulate harness.solution_titles from the markdown
#                         corpus (one-way derivation; no parity checking; the table and its
#                         indexes are never dropped, only emptied). A human runs this
#                         directly, so it fails LOUDLY on error.
#   "<candidate title>"   Print up to 5 corpus titles above the similarity threshold, with
#                         paths. This is the /codify-invoked path and is FAIL-SILENT by
#                         design (PG Lab rail: "Postgres down or ocrecipes_lab missing ->
#                         no-op instantly") — any DB error means "advisory unavailable":
#                         no output, exit 0, so the /codify skill falls back to its
#                         existing title grep. An empty-but-reachable result (no match
#                         above threshold) uses the exact same silent signal; the skill
#                         does not need to (and cannot) tell the two apart, by design.
#
# Frontmatter parsing follows the same awk approach as .claude/hooks/session-recent-issues.sh
# (title/created unwrap, single-line inline-flow tags array). "summary" is the first
# non-blank, non-heading line of the body after the H1 (usually the sentence right after
# `## Rule` / `## Problem` / `## When this applies`) — stored in the projection per the
# schema, but v1 similarity scoring compares candidate titles against corpus TITLES only
# (matches literally what /codify compares); summary is available for future tuning.
#
# PG_LAB_SOLUTIONS_DIR overrides the corpus root — the test seam, mirroring
# session-recent-issues.sh's RECENT_SOLUTIONS_DIR. PG_LAB_NEARDUP_THRESHOLD overrides the
# similarity cutoff (default 0.45 — conservative starting point per the todo; the value
# probe below doubles as tuning data).
#
# Usage:
#   scripts/pg-lab/codify-neardup.sh --rebuild
#   scripts/pg-lab/codify-neardup.sh "<candidate title>"
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LAB_DATABASE_URL="${LAB_DATABASE_URL:-postgresql://localhost/ocrecipes_lab}"
SOLUTIONS_DIR="${PG_LAB_SOLUTIONS_DIR:-$PROJECT_ROOT/docs/solutions}"
THRESHOLD="${PG_LAB_NEARDUP_THRESHOLD:-0.45}"

# Hard safety rail: --rebuild TRUNCATEs harness.solution_titles, and query mode connects
# to whatever LAB_DATABASE_URL resolves to — neither must ever run against a real app
# database. Loud failure even in query mode's otherwise fail-silent design: a misconfigured
# LAB_DATABASE_URL is a bug to surface, not an "environment temporarily unavailable" case
# the fail-silent contract exists for. See init.sh for the matching guard.
case "${LAB_DATABASE_URL##*/}" in
  nutricam | ocrecipes_solutions)
    echo "codify-neardup.sh: refusing — LAB_DATABASE_URL resolves to '${LAB_DATABASE_URL##*/}', a real app database, not a PG Lab database" >&2
    exit 1
    ;;
esac

MODE="${1:-}"

if [ -z "$MODE" ]; then
  echo "usage: $0 --rebuild | \"<candidate title>\"" >&2
  exit 1
fi

# --- awk frontmatter extractor: one CSV row per solution file -------------------------
# Columns: path,title,summary,tags,created (created bare/unquoted so an empty value loads
# as SQL NULL, not an empty string, into the DATE column).
extract_csv() {
  find "$SOLUTIONS_DIR" -type f -name '*.md' \
      ! -path '*/_manifests/*' ! -name 'README.md' \
      -exec awk -v root="${SOLUTIONS_DIR%/}/" -v sq="'" '
        # Unwrap a frontmatter scalar: strip the key, trim, then remove a double- or
        # single-quote wrapper. YAML doubles embedded single quotes; undouble them.
        function unq(v) {
          sub(/^[a-z_]+:[ \t]*/, "", v); sub(/[ \t\r]+$/, "", v)
          if (v ~ /^".*"$/) { v = substr(v, 2, length(v) - 2) }
          else if (v ~ ("^" sq ".*" sq "$")) { v = substr(v, 2, length(v) - 2); gsub(sq sq, sq, v) }
          return v
        }
        # Unwrap a single-line inline-flow array: `tags: [a, b, c]` -> `a, b, c`.
        function unarr(v) {
          sub(/^[a-z_]+:[ \t]*/, "", v); sub(/[ \t\r]+$/, "", v)
          gsub(/^\[/, "", v); gsub(/\]$/, "", v)
          return v
        }
        # CSV-quote a field: double any embedded double-quote, wrap in double-quotes.
        function csvq(v) {
          gsub(/"/, "\"\"", v)
          return "\"" v "\""
        }
        FNR == 1 { fm = 0; created = ""; title = ""; tags = ""; summary = ""; body = 0 }
        /^---[ \t\r]*$/ {
          fm++
          if (fm == 2) { body = 1 }
          next
        }
        fm == 1 && /^created:/ { created = unq($0) }
        fm == 1 && /^title:/   { title = unq($0) }
        fm == 1 && /^tags:/    { tags = unarr($0) }
        body && summary == "" {
          line = $0
          gsub(/^[ \t\r]+|[ \t\r]+$/, "", line)
          if (line == "") { next }
          if (line ~ /^#+[ \t]/) { next }   # H1/H2/... heading line, not the paragraph
          summary = line
          if (title != "") {
            rel = substr(FILENAME, length(root) + 1)
            datefield = (created ~ /^[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]$/) ? created : ""
            printf "%s,%s,%s,%s,%s\n", csvq(rel), csvq(title), csvq(summary), csvq(tags), datefield
          }
          nextfile
        }
      ' {} + 2>/dev/null
}

if [ "$MODE" = "--rebuild" ]; then
  # Loud mode: a human runs this directly and wants to see failures.
  if ! command -v psql >/dev/null 2>&1; then
    echo "codify-neardup.sh --rebuild: psql not found on PATH" >&2
    exit 1
  fi
  if [ ! -d "$SOLUTIONS_DIR" ]; then
    echo "codify-neardup.sh --rebuild: SOLUTIONS_DIR not found: $SOLUTIONS_DIR" >&2
    exit 1
  fi

  psql -X -q -v ON_ERROR_STOP=1 -d "$LAB_DATABASE_URL" -f "$SCRIPT_DIR/schema/codify-neardup.sql" || {
    echo "codify-neardup.sh --rebuild: failed to apply schema" >&2
    exit 1
  }

  TMP_CSV="$(mktemp)"
  trap 'rm -f "$TMP_CSV"' EXIT

  extract_csv > "$TMP_CSV"

  ROWCOUNT="$(wc -l < "$TMP_CSV" | tr -d ' ')"
  # Count-and-fail-on-zero (docs/solutions/logic-errors/glob-runner-loop-fails-open-count-
  # and-fail-on-zero-2026-07-03.md): an empty scan must never silently truncate the table.
  if [ "$ROWCOUNT" -eq 0 ]; then
    echo "codify-neardup.sh --rebuild: 0 solution files parsed under $SOLUTIONS_DIR — refusing to truncate the table" >&2
    exit 1
  fi

  psql -X -q -v ON_ERROR_STOP=1 -d "$LAB_DATABASE_URL" <<PSQL || { echo "codify-neardup.sh --rebuild: load failed" >&2; exit 1; }
BEGIN;
TRUNCATE harness.solution_titles;
\copy harness.solution_titles (path, title, summary, tags, created) FROM '$TMP_CSV' WITH (FORMAT csv)
COMMIT;
PSQL

  echo "✓ rebuilt harness.solution_titles: $ROWCOUNT rows"
  exit 0
fi

# --- Query mode: fail-silent ------------------------------------------------------------
CANDIDATE="$MODE"
command -v psql >/dev/null 2>&1 || exit 0

RESULT="$(psql -X -q -tA -F $'\t' -v ON_ERROR_STOP=1 -d "$LAB_DATABASE_URL" -v cand="$CANDIDATE" <<'SQL' 2>/dev/null
SELECT path, round(similarity(title, :'cand')::numeric, 3) AS score
FROM harness.solution_titles
ORDER BY similarity(title, :'cand') DESC
LIMIT 5;
SQL
)"
RC=$?
# DB truly unreachable (bad connection, missing table, etc.) — cannot even log. Stay silent.
[ "$RC" -eq 0 ] || exit 0

TOP_SCORE=""
[ -z "$RESULT" ] || TOP_SCORE="$(printf '%s\n' "$RESULT" | head -n1 | cut -f2)"

# Value probe: log every invocation that reached the DB layer — hit, miss, AND a reachable
# but empty/unpopulated harness.solution_titles (top_score NULL) — not just hits. Without
# the empty case, "never invoked / never rebuilt" is indistinguishable in the log from
# "genuinely zero near-dup hits ever occurred", which would confound the 2026-10-01
# prune-date decision (docs/solutions/README.md-adjacent schema comment). Best-effort —
# never let logging block the result. NOTE: psql -v/:'var' substitution only runs on
# script/stdin input, NOT on a -c string (a -c "...:'var'..." raises a syntax error) — this
# must go through stdin like the SELECT above, not -c. Truncate the logged candidate to
# 500 chars — it's an append-only ledger, not a place for a caller's accidental essay.
CANDIDATE_LOG="${CANDIDATE:0:500}"
if [ -z "$TOP_SCORE" ]; then
  psql -X -q -d "$LAB_DATABASE_URL" -v cand="$CANDIDATE_LOG" >/dev/null 2>&1 <<'SQL' || true
INSERT INTO harness.codify_neardup_log (candidate, top_score) VALUES (:'cand', NULL);
SQL
else
  psql -X -q -d "$LAB_DATABASE_URL" -v cand="$CANDIDATE_LOG" -v score="$TOP_SCORE" >/dev/null 2>&1 <<'SQL' || true
INSERT INTO harness.codify_neardup_log (candidate, top_score) VALUES (:'cand', :score);
SQL
fi

[ -n "$RESULT" ] || exit 0
printf '%s\n' "$RESULT" | awk -F'\t' -v thr="$THRESHOLD" -v OFS=' ' '
  $2 + 0 >= thr { printf "%s (score %s)\n", $1, $2 }
'
exit 0
