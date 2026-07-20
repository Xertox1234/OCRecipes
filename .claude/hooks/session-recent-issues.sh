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
        if (fm == 2) {
          if (created >= thr &&
              created ~ /^[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]$/) {
            rel = substr(FILENAME, length(root) + 1)
            printf "%d\t%s\t%s\t%s\t%s\n", (track == "bug"), created, track, title, rel
          }
          # Frontmatter is closed — skip the body (~85% of corpus I/O).
          # nextfile: POSIX-2024; supported by BSD awk, gawk, mawk >=1.3.3.
          nextfile
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
# DOC_PATHS: comma-joined repo-relative doc ids delivered by this digest, for the PG Lab
# usage-telemetry tail call below — reuses the already-parsed $rel, no recomputation.
DOC_PATHS=""
while IFS=$'\t' read -r _bug created track title rel; do
  [ -n "$created" ] || continue
  category="${rel%%/*}"
  DIGEST+=$'\n'"- ${created} [${track}/${category}] ${title} — docs/solutions/${rel}"
  DOC_PATHS="${DOC_PATHS:+$DOC_PATHS,}docs/solutions/${rel}"
done <<< "$ROWS"

# PG Lab usage telemetry (fire-and-forget, one-shot SessionStart event) — backgrounded +
# disowned so a slow/unreachable lab DB can never delay session start; stdout/stderr are
# redirected away so a logging failure can never surface in this hook's own output.
# PATTERN_INJECT_NO_LOG=1 is a hard kill switch (skips even spawning the subprocess).
if [ "${PATTERN_INJECT_NO_LOG:-0}" != "1" ]; then
  LOG_SCRIPT="$PROJECT_ROOT/scripts/pg-lab/log-injection.sh"
  if [ -f "$LOG_SCRIPT" ]; then
    INPUT=$(cat)
    SID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null || echo "")
    # \x1f (ASCII Unit Separator), NOT \t: this line has edited_path AND domain both empty
    # (a SessionStart digest is not scoped to a file or a domain) — bash's `read` collapses
    # adjacent tab-delimited empty fields even with IFS set to tab alone, which would
    # misalign every field after them. See log-injection.sh's header comment.
    # Trailing empty field is agent_id: always empty here — SessionStart is definitionally
    # always the top-level context (a subagent dispatch never fires its own SessionStart),
    # so there is nothing to extract; the literal empty keeps this producer on the same
    # 8-field contract as inject-patterns.sh's LOG_TSV lines.
    LOG_LINE=$(printf '%s\x1f%s\x1f%s\x1f%s\x1f%s\x1f%s\x1f%s\x1f%s' "$SID" "SessionStart" "" "" "injected" "$(( $(printf '%s' "$DIGEST" | wc -c) ))" "$DOC_PATHS" "")
    { printf '%s\n' "$LOG_LINE" | bash "$LOG_SCRIPT" >/dev/null 2>&1; } &
    disown 2>/dev/null || true
  fi
fi

jq -n --arg ctx "$DIGEST" \
  '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":$ctx}}'
exit 0
