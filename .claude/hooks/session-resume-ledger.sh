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

# DIRECTORY FIRST, then the file. Everything below this point becomes additionalContext,
# i.e. model input, so a path that is not demonstrably ours is refused rather than read.
# The order matters: when the DIRECTORY is a symlink, `-L` on the file inside it is false,
# so checking only the file would pass on a directory someone else controls.
context_ledger_path_ok "$LEDGER_DIR" || exit 0

RESUME="$LEDGER_DIR/resume.md"
context_ledger_path_ok "$RESUME" || exit 0
[ -s "$RESUME" ] || exit 0

# Clamp on READ, not just on write. The writer's own 6144-byte cap bounds what THIS repo
# produces and says nothing about what it will consume: measured against the pre-fix path,
# planted files of 4 KiB, 64 KiB, 200 KB, 400 KB and 900 KB all reached additionalContext
# in full, and a 3 MB file emitted ZERO bytes while still exiting 0 — the jq `--arg`
# execve hit ARG_MAX. So the only ceiling was an accidental OS limit that fails silently
# rather than degrading. 8192 is the writer's cap with headroom, so a digest this repo
# wrote is never truncated by it.
DIGEST=$(head -c 8192 "$RESUME" 2>/dev/null) || exit 0
[ -n "$DIGEST" ] || exit 0

jq -n --arg ctx "$DIGEST" \
  '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":$ctx}}'
exit 0
