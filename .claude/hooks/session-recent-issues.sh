#!/usr/bin/env bash
# SessionStart — emit a compact digest of solutions codified in the last 14 days (bug-track
# first) as additionalContext, read from the canonical docs/solutions/ tree.
# Fail-silent: any missing tool / unreadable corpus exits 0 with no output (never block a session).
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)" || exit 0
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)" || exit 0
# RECENT_SOLUTIONS_DIR override is the test seam (fixtures live outside the repo).
SOLUTIONS_DIR="${RECENT_SOLUTIONS_DIR:-$PROJECT_ROOT/docs/solutions}"
[ -d "$SOLUTIONS_DIR" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0

# 14-day window threshold, computed once: BSD date uses -v, GNU date uses -d. ISO dates
# compare correctly as strings, so the filter below is a lexicographic >=.
THRESHOLD=$(date -v-14d +%Y-%m-%d 2>/dev/null || date -d '14 days ago' +%Y-%m-%d 2>/dev/null)
[ -n "$THRESHOLD" ] || exit 0

# One awk pass over the corpus frontmatter → "bugflag<TAB>created<TAB>track<TAB>title<TAB>rel"
# for every in-window solution. rel is stripped via substr (not regex — paths may contain
# metacharacters). Sort: bug-track first, then created desc; cap 12 (mirrors the retired SQL
# `ORDER BY (track='bug') DESC, created DESC LIMIT 12`). NOTE: no `|| exit 0` on this
# pipeline — under pipefail a SIGPIPE from head would discard legitimate data (see
# docs/solutions/logic-errors/pipefail-echo-grep-condition-fails-open-via-sigpipe-2026-06-27.md);
# the [ -n "$ROWS" ] guard below is the only emptiness check.
ROWS=$(find "$SOLUTIONS_DIR" -type f -name '*.md' \
    ! -path '*/_manifests/*' ! -name 'README.md' \
    -exec awk -v thr="$THRESHOLD" -v sq=\' '
      # Unwrap a frontmatter scalar: strip the key, trim, then remove a double- or
      # single-quote wrapper. YAML doubles embedded single quotes; undouble them.
      function unq(v) {
        sub(/^[a-z_]+:[ \t]*/, "", v); sub(/[ \t\r]+$/, "", v)
        if (v ~ /^".*"$/) { v = substr(v, 2, length(v) - 2) }
        else if (v ~ ("^" sq ".*" sq "$")) { v = substr(v, 2, length(v) - 2); gsub(sq sq, sq, v) }
        return v
      }
      FNR == 1 { fm = 0; created = ""; track = ""; title = "" }
      /^---[ \t\r]*$/ {
        fm++
        if (fm == 2 && created >= thr &&
            created ~ /^[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]$/) {
          rel = substr(FILENAME, length(root) + 1)
          printf "%d\t%s\t%s\t%s\t%s\n", (track == "bug"), created, track, title, rel
        }
        next
      }
      fm == 1 && /^created:/ { created = unq($0) }
      fm == 1 && /^track:/   { track = unq($0) }
      fm == 1 && /^title:/   { title = unq($0) }
    ' root="$SOLUTIONS_DIR/" {} + 2>/dev/null \
  | sort -t$'\t' -k1,1nr -k2,2r | head -n 12)
[ -n "$ROWS" ] || exit 0

DIGEST="[RECENT SOLUTIONS — codified in the last 14 days, bug-track first]"
DIGEST+=$'\n'"Pull more on demand: grep docs/solutions/ — e.g. \`grep -ril '^title:.*<keyword>' docs/solutions --include='*.md' | grep -v _manifests\`; schema in docs/solutions/README.md."
while IFS=$'\t' read -r _bug created track title rel; do
  [ -n "$created" ] || continue
  category="${rel%%/*}"
  DIGEST+=$'\n'"- ${created} [${track}/${category}] ${title} — docs/solutions/${rel}"
done <<< "$ROWS"

jq -n --arg ctx "$DIGEST" \
  '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":$ctx}}'
exit 0
