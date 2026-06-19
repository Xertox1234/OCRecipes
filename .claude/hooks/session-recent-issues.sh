#!/usr/bin/env bash
# SessionStart — emit a compact digest of solutions codified in the last 14 days (bug-track
# first) as additionalContext, so recent known issues surface without anyone querying the DB.
# Fail-silent: any missing tool / DB outage exits 0 with no output (never block a session).
set -uo pipefail

[ -n "${SOLUTIONS_DB_READONLY_URL:-}" ] || exit 0
command -v psql >/dev/null 2>&1 || exit 0

ROWS=$(psql "$SOLUTIONS_DB_READONLY_URL" -tAF$'\t' -c \
  "SELECT created, track, category, title, source_path
     FROM solutions
    WHERE created >= CURRENT_DATE - 14
    ORDER BY (track = 'bug') DESC, created DESC
    LIMIT 12;" 2>/dev/null) || exit 0
[ -n "$ROWS" ] || exit 0

DIGEST="[RECENT SOLUTIONS — codified in the last 14 days, bug-track first]"
DIGEST+=$'\n'"Pull more on demand: \`npm run solutions:db:recent\` or the recent_solutions MCP tool."
while IFS=$'\t' read -r created track category title source_path; do
  [ -n "$created" ] || continue
  rel="docs/solutions/${source_path#docs/solutions/}"
  DIGEST+=$'\n'"- ${created} [${track}/${category}] ${title} — ${rel}"
done <<< "$ROWS"

jq -n --arg ctx "$DIGEST" \
  '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":$ctx}}'
exit 0
