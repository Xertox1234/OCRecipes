#!/usr/bin/env bash
# Stop hook — surface todos created or modified during this session.
# Scans todos/ for files touched in the last ~8 hours; outputs a systemMessage
# if any exist so the model can confirm or follow up at session end.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TODOS_DIR="$PROJECT_ROOT/todos"

[ -d "$TODOS_DIR" ] || exit 0

RECENT=$(find "$TODOS_DIR" -maxdepth 2 -name "*.md" \
  -not -path "*/archive/*" \
  -not -name "TEMPLATE.md" \
  -mmin -480 2>/dev/null | sort -r || true)

[ -n "$RECENT" ] || exit 0

LINES=()
while IFS= read -r f; do
  [ -n "$f" ] || continue
  TITLE=$(grep -m1 '^title:' "$f" 2>/dev/null \
    | sed -E 's/^title:[[:space:]]*//' | tr -d '"' || echo "(no title)")
  STATUS=$(grep -m1 '^status:' "$f" 2>/dev/null \
    | sed -E 's/^status:[[:space:]]*//' || echo "unknown")
  REL="${f#"$PROJECT_ROOT"/}"
  LINES+=("  [$STATUS] $REL — $TITLE")
done <<< "$RECENT"

[ "${#LINES[@]}" -gt 0 ] || exit 0

MSG="Todos filed or modified this session (${#LINES[@]}):"$'\n'
for line in "${LINES[@]}"; do
  MSG+="$line"$'\n'
done

jq -n --arg msg "$MSG" \
  '{"hookSpecificOutput":{"hookEventName":"Stop","systemMessage":$msg}}'
