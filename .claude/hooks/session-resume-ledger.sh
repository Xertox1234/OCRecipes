#!/usr/bin/env bash
# SessionStart — inject the context ledger written by precompact-ledger.sh.
#
# Gated on source == "compact". A hook that fires on every SessionStart would inject
# stale ledger state into unrelated sessions, and would still pass every other test in
# the suite — which is why that case is mutation-checked (spec §8).
#
# Fail-open: any missing/unreadable state exits 0 with no output.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)" || exit 0
# shellcheck source=lib/context-ledger-path.sh
. "$SCRIPT_DIR/lib/context-ledger-path.sh" 2>/dev/null || exit 0
command -v jq >/dev/null 2>&1 || exit 0

INPUT=$(cat 2>/dev/null) || exit 0

SOURCE=$(printf '%s' "$INPUT" | jq -r '.source // empty' 2>/dev/null) || exit 0
[ "$SOURCE" = "compact" ] || exit 0

SID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null) || exit 0
LEDGER_DIR=$(context_ledger_dir "$SID") || exit 0

RESUME="$LEDGER_DIR/resume.md"
[ -s "$RESUME" ] || exit 0

DIGEST=$(cat "$RESUME" 2>/dev/null) || exit 0
[ -n "$DIGEST" ] || exit 0

jq -n --arg ctx "$DIGEST" \
  '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":$ctx}}'
exit 0
