#!/usr/bin/env bash
# own_agent_root <cwd> <agent_id>: print the root of the caller's OWN isolation worktree
# (<main>/.claude/worktrees/agent-<agent_id>) when the cwd is inside it; return 1 otherwise.
#
# Sourced by guard-worktree-isolation.sh and git-safety.sh. A worktree contract registry is
# per session, and subagents share the parent's session id, so the registry can list only OTHER
# worktrees while a subagent works in its own (5 of 31 guard denials, 10-30..11-01, harness
# item 8). The hook input's agent_id is absent at the top level and equals the subagent's
# agent-<id> worktree suffix (314 of 314 subagent edits under .claude/worktrees/agent-* matched,
# 10-29..11-01). Requiring BOTH that agent_id and a cwd inside agent-<agent_id> admits exactly
# the subagent that owns the worktree: the parent session (no agent_id) and siblings get nothing.
own_agent_root() {
  local cwd="$1" id="$2" c
  case "$id" in "" | *[!0-9A-Za-z]*) return 1 ;; esac
  case "$cwd" in /*) ;; *) return 1 ;; esac
  case "$cwd/" in */../* | */./*) return 1 ;; esac
  c="$cwd/"
  case "$c" in */.claude/worktrees/agent-"$id"/*) ;; *) return 1 ;; esac
  printf '%s\n' "${c%%/.claude/worktrees/agent-"$id"/*}/.claude/worktrees/agent-$id"
}
