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

# Fork-free: a $(cd ...) subshell here would be the ENTIRE added cost of reaching the shared
# fast-path helper below (measured ~1.9ms/call; sourcing itself is free) — this HERE now runs
# on every Bash tool call, not just ones that already matched the old inline filter. The
# */*) arm is load-bearing: a bare "${BASH_SOURCE[0]%/*}" returns the filename unchanged when
# invoked with no slash, the source below then fails, and this hook silently exits before the
# matcher ever runs.
case "${BASH_SOURCE[0]}" in */*) HERE="${BASH_SOURCE[0]%/*}" ;; *) HERE=. ;; esac

# Match git ops that may move HEAD via the shared quote-AWARE matcher (lib/cmd-detect.sh):
# commit (+ --amend), push, rebase, reset (bare reset is idempotent here — re-writes the same
# SHA), pull, merge, cherry-pick. A quoted mention of one of these verbs must NOT stamp the
# baseline (that would silently absorb a real drift). Cheap superset first, via the shared
# fast-path helper (lib/fastpath-filter.sh). This hook WRITES the baseline, so on an
# unsourceable lib fail SILENT (skip the stamp): a stale baseline only causes a false drift
# warning next time, whereas a wrongful write absorbs a real drift. If the fast-path helper
# specifically is unsourceable, do NOT exit here — fall through to the lib/cmd-detect.sh
# sourcing below, which already exits 0 (silent) on its own failure; losing the cheap
# pre-filter only costs performance in that (broken-install) case, never a decision.
if . "$HERE/lib/fastpath-filter.sh" 2>/dev/null && declare -F cmd_fastpath_has >/dev/null; then
  cmd_fastpath_has "$CMD" '*git*' || exit 0
fi
. "$HERE/lib/cmd-detect.sh" 2>/dev/null && declare -F cmd_is_git_head_mover >/dev/null || exit 0
cmd_is_git_head_mover "$CMD" || exit 0

# The drift baseline is keyed by SESSION and holds THIS cwd's HEAD — there is no per-repo
# baseline. A `git -C /elsewhere` op therefore says nothing about it: cwd's HEAD did not
# move, so stamping it would ABSORB a real external drift here.
# Skipping is the CORRECT semantics for a cwd-keyed store, not a fallback. An unresolvable
# GLOBAL-form redirect (`-C`, `--git-dir`, `--work-tree`) skips too, and that is also this
# hook's previous behaviour, because the old matcher could not see one. An inline `GIT_DIR=`
# assignment is deliberately NOT in that class — `_CMD_POS_PREFIX`'s env absorber has always
# matched it, so it resolves to cwd and this hook behaves exactly as it did before (treating
# the two classes alike dropped a real deny in the sibling gate; CRITICAL, review 2026-09-01).
# `git -C <this repo>` spelled out in full still proceeds — the identity test compares
# resolved git dirs, not path strings.
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
