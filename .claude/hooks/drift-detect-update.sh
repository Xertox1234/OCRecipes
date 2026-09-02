#!/usr/bin/env bash
# PostToolUse(Bash) — record HEAD after any Claude-initiated HEAD-moving git op.
#
# Companion to drift-detect.sh (PreToolUse). After Claude runs a git op that moves HEAD
# (commit, push, amend, rebase, reset, pull, merge, cherry-pick), record the current HEAD
# SHA so the next PreToolUse drift-detect check knows Claude is the one who moved it.
#
# Read-only git ops (status, log, diff, show, fetch without merge) must NOT update the
# baseline — otherwise an external drift that occurs between a `git log` and a commit
# would be absorbed and silently missed.
#
# Design principles:
#   - NEVER blocks: always exits 0.
#   - Keyed by session_id from the hook JSON (symmetric with drift-detect.sh).
#   - Fails open on any parse / git error.
#
# Tests: .claude/hooks/test-drift-detect.sh
set -uo pipefail

command -v jq >/dev/null 2>&1 || exit 0

INPUT=$(cat)
TOOL=$(printf '%s' "$INPUT" | jq -re '.tool_name' 2>/dev/null) || exit 0
[ "$TOOL" = "Bash" ] || exit 0
CMD=$(printf '%s' "$INPUT" | jq -re '.tool_input.command' 2>/dev/null) || exit 0

# Match git ops that may move HEAD via the shared quote-AWARE matcher (lib/cmd-detect.sh):
# commit (+ --amend), push, rebase, reset (bare reset is idempotent here — re-writes the same
# SHA), pull, merge, cherry-pick. A quoted mention of one of these verbs must NOT stamp the
# baseline (that would silently absorb a real drift). Cheap superset first. This hook WRITES the
# baseline, so on an unsourceable lib fail SILENT (skip the stamp): a stale baseline only causes
# a false drift warning next time, whereas a wrongful write absorbs a real drift.
# Two-stage necessary-substring filter. Stage 1 is the zero-copy glob on raw $CMD.
# Stage 2 runs ONLY on a stage-1 miss, retesting with the characters cmd_words can
# DELETE removed (quotes, backslashes, newlines) — because the cmd_is_* matcher below
# reads `cmd_words`, which deletes quote characters and so sees a verb this filter's
# raw text does not contain: `git com"mit"` holds no literal `commit`, so a
# single-stage filter exited 0 and the matcher was never asked (review, 2026-08-16).
# cmd_words only deletes those characters or inserts the letter `x`, and the needle
# below contains no `x`, so stage 2 is a superset by construction. Four literal
# substitutions, not a bracket class: the class form costs ~1450ms on a 3KB command
# under bash 3.2 versus ~5.5ms for these.
_PRE=0
case "$CMD" in *git*) _PRE=1 ;; esac
if [ "$_PRE" = 0 ]; then
  _T=${CMD//\'/}; _T=${_T//\"/}; _T=${_T//\\/}; _T=${_T//$'\n'/}; _T=${_T//\$/}
  case "$_T" in *git*) _PRE=1 ;; esac
fi
[ "$_PRE" = 1 ] || exit 0
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/lib/cmd-detect.sh" 2>/dev/null && declare -F cmd_is_git_head_mover >/dev/null || exit 0
cmd_is_git_head_mover "$CMD" || exit 0

# The drift baseline is keyed by SESSION and holds THIS cwd's HEAD — there is no per-repo
# baseline. A `git -C /elsewhere` op therefore says nothing about it: cwd HEAD did not move, so stamping it would ABSORB a real external drift. Both
# were invisible to the matcher before 2026-09-01, so skipping keeps the behaviour that was
# already correct here instead of inventing a cross-repo one. An unresolvable redirect skips
# for the same reason. `git -C <this repo>` spelled out in full still proceeds — the identity
# test compares resolved git dirs, not path strings.
REPO=$(cmd_git_repo_dir "$CMD" "$_CMD_GIT_VERBS_HEAD_MOVER") || exit 0

# Ensure we're inside a git repo.
git rev-parse --git-dir >/dev/null 2>&1 || exit 0
if [ "$REPO" != "." ] && \
   [ "$(git -C "$REPO" rev-parse --absolute-git-dir 2>/dev/null)" != "$(git rev-parse --absolute-git-dir 2>/dev/null)" ]; then
  exit 0
fi

SESSION=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null || echo "")
[ -n "$SESSION" ] || exit 0

CURRENT_SHA=$(git rev-parse HEAD 2>/dev/null || echo "")
[ -n "$CURRENT_SHA" ] || exit 0

printf '%s' "$CURRENT_SHA" > "/tmp/claude-drift-detect-${SESSION}"
exit 0
