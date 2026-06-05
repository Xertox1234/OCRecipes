#!/usr/bin/env bash
# PreToolUse(Bash) — nudge when ≥5 Bash calls fire within 2 seconds.
# Concurrent batch calls interleave stdout/stderr and cause phantom failures.
# NEVER blocks: always exits 0.
set -uo pipefail

INPUT=$(cat)
TOOL=$(printf '%s' "$INPUT" | jq -re '.tool_name' 2>/dev/null) || exit 0
[ "$TOOL" = "Bash" ] || exit 0

# Allow test override of the temp file path.
BATCH_FILE="${BATCH_FILE_OVERRIDE:-/tmp/claude-bash-batch-${UID}}"
trap 'rm -f "${BATCH_FILE}.tmp"' EXIT

NOW=$(date +%s)

# Append current timestamp.
printf '%s\n' "$NOW" >> "$BATCH_FILE"

# Trim lines older than 10 seconds to prevent unbounded growth.
# Trim and count are best-effort: concurrent hook processes can race on the
# awk>tmp/mv replace, potentially under-counting by 1-2. Acceptable for an
# advisory-only nudge — large batches (5+) still trigger reliably.
CUTOFF=$((NOW - 10))
awk -v cutoff="$CUTOFF" '$1 > cutoff' "$BATCH_FILE" > "${BATCH_FILE}.tmp" 2>/dev/null \
  && mv "${BATCH_FILE}.tmp" "$BATCH_FILE" 2>/dev/null || true

# Count calls within the last 2 seconds.
WINDOW_START=$((NOW - 2))
RECENT=$(awk -v ws="$WINDOW_START" '$1 >= ws {count++} END {print count+0}' "$BATCH_FILE" 2>/dev/null || echo 0)

if [ "$RECENT" -ge 5 ]; then
  jq -n --argjson n "$RECENT" '{
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "additionalContext": ("Batch-size warning: " + ($n|tostring) + " Bash calls in the last 2 s. If results look inconsistent or a command appears to have failed without explanation, re-run it alone before diagnosing. Recommended maximum: 4 parallel Bash calls per response.")
    }
  }'
fi
exit 0
