#!/usr/bin/env bash
# PreToolUse(Bash) — detect when HEAD has advanced externally between Claude's git ops.
#
# When the user edits, commits, or rebases the same checkout in a parallel terminal
# while Claude works, HEAD moves without Claude knowing. This hook compares current
# HEAD to the last SHA Claude recorded (drift-detect-update.sh writes it after every
# HEAD-moving git op). If they differ, HEAD drifted externally — emit a warning.
#
# Design principles:
#   - WARN, never block (permissionDecision is never emitted here).
#   - Fires only on actual drift — silent on the no-drift path.
#   - First op: no baseline file → record current HEAD and exit silently.
#   - Keyed by session_id from the hook JSON (not $PPID — that differs across processes).
#   - Fails open on any parse / git error.
#
# Fires on: git commit, git push (any form).
# Companion: drift-detect-update.sh (PostToolUse) records HEAD after every Claude HEAD-mover.
# Tests: .claude/hooks/test-drift-detect.sh
set -uo pipefail

command -v jq >/dev/null 2>&1 || exit 0

INPUT=$(cat)
TOOL=$(printf '%s' "$INPUT" | jq -re '.tool_name' 2>/dev/null) || exit 0
[ "$TOOL" = "Bash" ] || exit 0
CMD=$(printf '%s' "$INPUT" | jq -re '.tool_input.command' 2>/dev/null) || exit 0

# Fork-free: a $(cd ...) subshell here would be the ENTIRE added cost of reaching the shared
# fast-path helper below (measured ~1.9ms/call; sourcing itself is free) — this HERE now runs
# on every Bash tool call, not just ones that already matched the old inline filter. The
# */*) arm is load-bearing: a bare "${BASH_SOURCE[0]%/*}" returns the filename unchanged when
# invoked with no slash, the source below then fails, and this hook silently exits before the
# matcher ever runs.
case "${BASH_SOURCE[0]}" in */*) HERE="${BASH_SOURCE[0]%/*}" ;; *) HERE=. ;; esac

# Match git commit or git push via the shared quote-AWARE matcher (lib/cmd-detect.sh) — a quoted
# mention like `-m "…; git push …"` must not trip a drift warning. Cheap superset first, via
# the shared fast-path helper (lib/fastpath-filter.sh). Advisory hook → fail SILENT if either
# lib is unsourceable: a missed warning is the safe direction, whereas matching the raw command
# would re-open the false warning on quoted mentions. If the fast-path helper specifically is
# unsourceable, do NOT exit here — fall through to the lib/cmd-detect.sh sourcing below, which
# already exits 0 (silent) on its own failure; losing the cheap pre-filter only costs
# performance in that (broken-install) case, never a decision.
if . "$HERE/lib/fastpath-filter.sh" 2>/dev/null && declare -F cmd_fastpath_has >/dev/null; then
  cmd_fastpath_has "$CMD" '*git*' || exit 0
fi
. "$HERE/lib/cmd-detect.sh" 2>/dev/null && declare -F cmd_is_git_commit_or_push >/dev/null || exit 0
cmd_is_git_commit_or_push "$CMD" || exit 0

# The drift baseline is keyed by SESSION and holds THIS cwd's HEAD — there is no per-repo
# baseline. A `git -C /elsewhere` op therefore says nothing about it, so warning about cwd
# drift on the strength of it would be off-topic.
# Skipping is the CORRECT semantics for a cwd-keyed store, not a fallback. An unresolvable
# GLOBAL-form redirect (`-C`, `--git-dir`, `--work-tree`) skips too, and that is also this
# hook's previous behaviour, because the old matcher could not see one. An inline `GIT_DIR=`
# assignment is deliberately NOT in that class — `_CMD_POS_PREFIX`'s env absorber has always
# matched it, so it resolves to cwd and this hook behaves exactly as it did before (treating
# the two classes alike dropped a real deny in the sibling gate; CRITICAL, review 2026-09-01).
# `git -C <this repo>` spelled out in full still proceeds — the identity test compares
# resolved git dirs, not path strings.
REPO=$(cmd_git_repo_dir "$CMD" "$_CMD_GIT_VERBS_COMMIT_PUSH") || exit 0

# Ensure we're inside a git repo.
git rev-parse --git-dir >/dev/null 2>&1 || exit 0
if [ "$REPO" != "." ] && \
   [ "$(git -C "$REPO" rev-parse --absolute-git-dir 2>/dev/null)" != "$(git rev-parse --absolute-git-dir 2>/dev/null)" ]; then
  exit 0
fi

SESSION=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null || echo "")
if [ -z "$SESSION" ]; then
  # No session_id available — can't key the baseline safely; skip detection.
  exit 0
fi

BASELINE_FILE="/tmp/claude-drift-detect-${SESSION}"

CURRENT_SHA=$(git rev-parse HEAD 2>/dev/null || echo "")
[ -n "$CURRENT_SHA" ] || exit 0

if [ ! -f "$BASELINE_FILE" ]; then
  # First git op this session — record baseline and exit silently.
  printf '%s' "$CURRENT_SHA" > "$BASELINE_FILE"
  exit 0
fi

STORED_SHA=$(cat "$BASELINE_FILE" 2>/dev/null || echo "")

if [ -z "$STORED_SHA" ] || [ "$STORED_SHA" = "$CURRENT_SHA" ]; then
  # No drift — stay silent.
  exit 0
fi

# HEAD moved without Claude recording it — external drift detected.
MSG="Drift detected: repo HEAD moved externally since Claude's last git op. Stored: ${STORED_SHA} → Current: ${CURRENT_SHA}. Likely cause: parallel-terminal commit, rebase, or push by the user. Re-check \`git log --oneline -5\` and \`git status\` to reconcile before proceeding. Durable fix: give each session its own checkout via the superpowers:using-git-worktrees skill so parallel work can't move HEAD underneath you. (Warn-only.)"

# Registry attribution (PG Lab session coordination, spec §6) — best-effort: empty when
# Postgres is down or the script is absent, leaving today's message untouched.
# Located from this script's own path, not cwd — this line EXECUTES the resolved file, so
# a cwd inside a nested repo would run that tree's script instead of ours. The repo passed
# as the attribution argument stays cwd-derived on purpose: that names which checkout
# drifted, which is a question about the agent's working tree, not about this hook.
COORD="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/scripts/pg-lab/session-coord.sh"
if [ -f "$COORD" ]; then
  ATTRIB=$(bash "$COORD" attribute-drift "$SESSION" "$(git rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null || true)
  [ -n "$ATTRIB" ] && MSG="$MSG $ATTRIB"
fi

jq -n --arg m "$MSG" '{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "additionalContext": $m
  }
}'
exit 0
