#!/usr/bin/env bash
# Force-remove leftover /todo executor worktrees (.claude/worktrees/agent-*) that
# are not in use. Called from .claude/skills/todo/SKILL.md (Phase 0 step 1 and
# Phase 5 step 6) — see those steps for why each signal exists.
#
# This lives in a script, not inline in the skill, because the skill loader
# substitutes `$0`–`$9` in SKILL.md text with the invocation's arguments: the
# inline copy rendered `w="$1"` as `w="unattended"`, so every worktree read as
# "safe to remove". scripts/check-skill-positional-params.js now blocks that.
#
# Usage (from the main checkout):
#   bash scripts/todo-worktree-sweep.sh                                        # Phase 0
#   bash scripts/todo-worktree-sweep.sh --exclude-session "$CLAUDE_CODE_SESSION_ID"   # Phase 5
#
# Prints one "removed worktree:" or "skipped worktree (in use):" line per
# worktree. Never fails the caller: the sweep always runs `git worktree prune`.

EXCLUDE_SESSION=""
while [ $# -gt 0 ]; do
  case "$1" in
    --exclude-session) EXCLUDE_SESSION="${2:-}"; shift 2 || shift ;;
    *) echo "todo-worktree-sweep: unknown argument: $1" >&2; exit 2 ;;
  esac
done

wt_in_use() {
  # $1 = absolute worktree path. Returns 0 = in use OR unknown (skip it), 1 = safe to remove.
  # Sets WT_REASON. Any error in a check counts as "in use" (fail-safe).
  w="$1"
  WT_REASON=""
  [ -d "$w" ] || return 1
  # Signal 1 — another session's contract registry lists it AND files changed in the last 120 min.
  # A crashed executor leaves its entry behind, so the entry alone proves nothing.
  # EXCLUDE_SESSION (Phase 5 only) = this session's id: its own executors have all returned.
  own="/tmp/claude-worktree-contracts-${EXCLUDE_SESSION:-__none__}"
  dirs=$(find -H /tmp -maxdepth 1 -type d -name 'claude-worktree-contracts-*' 2>/dev/null) \
    || { WT_REASON="registry listing errored"; return 0; }
  reg=""
  while IFS= read -r d; do
    [ -n "$d" ] && [ "$d" != "$own" ] || continue
    grep -rlxF -- "$w" "$d" >/dev/null 2>&1; rc=$?   # 0 = listed, 1 = not listed, 2+ = error
    [ "$rc" -ge 2 ] && { WT_REASON="registry check errored ($d)"; return 0; }
    [ "$rc" -eq 0 ] && { reg="$d"; break; }
  done <<< "$dirs"
  if [ -n "$reg" ]; then
    recent=$(find "$w" \( -name node_modules -o -name .git \) -prune -o -type f -mmin -120 -print -quit 2>/dev/null) \
      || { WT_REASON="registry check errored"; return 0; }
    [ -n "$recent" ] && { WT_REASON="listed in registry $reg and files changed <120 min ago"; return 0; }
  fi
  # Signal 2 — any file in the worktree (not node_modules/.git) modified in the last 30 min.
  recent=$(find "$w" \( -name node_modules -o -name .git \) -prune -o -type f -mmin -30 -print -quit 2>/dev/null) \
    || { WT_REASON="file-activity check errored"; return 0; }
  [ -n "$recent" ] && { WT_REASON="file changed <30 min ago: $recent"; return 0; }
  # Signal 3 — a running process has its cwd inside the worktree.
  cwds=$(lsof -d cwd -Fn 2>/dev/null) || { WT_REASON="lsof errored"; return 0; }
  [ -n "$cwds" ] || { WT_REASON="lsof returned nothing"; return 0; }
  printf '%s\n' "$cwds" | awk -v w="$w" '/^n/ { n = substr($0, 2); if (n == w || index(n, w "/") == 1) f = 1 } END { exit !f }' \
    && { WT_REASON="a process has its cwd inside it"; return 0; }
  return 1
}

# Non-porcelain form + manual `~` expansion: the rtk git proxy rewrites
# --porcelain into a condensed `~`-shorthand format (see the skill's Phase 0 note).
git worktree list | awk '/\.claude\/worktrees\/agent-/ {sub(/ +[0-9a-f]{4,40} +\[[^]]*\].*$/, ""); print}' | while read -r wt; do
  wt="${wt/#\~/$HOME}"
  if wt_in_use "$wt"; then echo "skipped worktree (in use): $wt — $WT_REASON"; continue; fi
  git worktree unlock "$wt" 2>/dev/null
  git worktree remove --force "$wt" 2>/dev/null && echo "removed worktree: $wt"
done
git worktree prune
exit 0
