#!/usr/bin/env bash
# PreCompact — build a verification-ledger digest for injection after compaction.
#
# Two INDEPENDENT tiers (spec §3 decision 3):
#   curated   — claims paired with the command that established them (ledger-note.sh)
#   mechanical— commands that RAN, extracted from the transcript. NOT a verification tier.
# Independent inputs mean either can be absent; both absent yields an empty digest, which
# is the one deliberate silent case (spec §9).
#
# Fail-open: every failure path exits 0 with no output (spec §7).
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)" || exit 0
# shellcheck source=lib/context-ledger-path.sh
. "$SCRIPT_DIR/lib/context-ledger-path.sh" 2>/dev/null || exit 0
command -v jq >/dev/null 2>&1 || exit 0

INPUT=$(cat 2>/dev/null) || exit 0
SID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null) || exit 0
LEDGER_DIR=$(context_ledger_dir "$SID") || exit 0

# --- Transcript resolution chain (spec §4.2) --------------------------------
# 1) stdin  2) cwd-INDEPENDENT glob  3) none.
# The glob is required rather than a computed path: the project dir is cwd-derived and
# moves on worktree entry, so a computed path misses exactly the worktree-heavy sessions
# this project runs.
TRANSCRIPT=$(printf '%s' "$INPUT" | jq -r '.transcript_path // empty' 2>/dev/null)
if [ -z "$TRANSCRIPT" ] || [ ! -r "$TRANSCRIPT" ]; then
  TRANSCRIPT=""
  for cand in "$HOME"/.claude/projects/*/"$SID".jsonl; do
    if [ -r "$cand" ]; then TRANSCRIPT="$cand"; break; fi
  done
fi

CURATED=""
# Bounded at 2048 bytes, keeping the MOST RECENT entries. The curated tier grows one line
# per ledger-note.sh call and is otherwise unbounded, so without this the digest can exceed
# spec §5.2's 4KB hard cap. The floor below is already at its minimum (12 lines, commands
# clipped to 100 chars), so when the total still overruns, this is the tier that must yield.
[ -r "$LEDGER_DIR/curated.md" ] && CURATED=$(tail -c 2048 "$LEDGER_DIR/curated.md" 2>/dev/null)

FLOOR=""
if [ -n "$TRANSCRIPT" ]; then
  # One line per Bash call: description ← first line of command, truncated.
  # `tail -n 12` mirrors session-recent-issues.sh's cap; dedup via awk keeps repeats out.
  FLOOR=$(jq -r '
      select(.type=="assistant")
      | .message.content[]?
      | select(.type=="tool_use" and .name=="Bash")
      | "  \(.input.description // "(no description)") ← \(.input.command | split("\n")[0] | .[0:100])"
    ' "$TRANSCRIPT" 2>/dev/null | awk '!seen[$0]++' | tail -n 12)
fi

# Both tiers empty -> write nothing. Spec §9: emitting "nothing captured" would spend
# post-compact budget to convey no information.
if [ -z "$CURATED" ] && [ -z "$FLOOR" ]; then
  exit 0
fi

mkdir -p "$LEDGER_DIR" 2>/dev/null || exit 0

{
  echo "[CONTEXT LEDGER — verification state carried across compaction]"
  echo "Native compaction preserves the narrative. This carries what it cannot: which"
  echo "facts were MEASURED vs ASSUMED. Re-verify before relying on an ASSUMED line."
  if [ -n "$CURATED" ]; then
    echo ""
    printf '%s\n' "$CURATED"
  fi
  if [ -n "$FLOOR" ]; then
    echo ""
    echo "MECHANICAL FLOOR — commands run this session (most recent 12)"
    echo "NOTE: these record what RAN, not what was concluded. Not a verification tier."
    printf '%s\n' "$FLOOR"
  fi
  echo ""
  echo "Full history: session ${SID} — glob ~/.claude/projects/*/${SID}.jsonl"
  echo "(the recorded path may not resolve if this session entered a worktree)"
} > "$LEDGER_DIR/resume.md" 2>/dev/null || exit 0

exit 0
