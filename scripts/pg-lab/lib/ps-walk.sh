#!/usr/bin/env bash
# scripts/pg-lab/lib/ps-walk.sh — sourced helpers shared by session-coord.sh and
# db-serial-lock.sh (spec §5.1a / §5.2): resolve the long-lived Claude Code process pid
# from any descendant shell, and map it to the harness session_id via the bridge file
# written by `session-coord.sh register`.
#
# Sourced, not executed. Fail-soft contract: every function prints NOTHING and returns 1
# on failure — callers are fail-silent hooks and must be able to `|| exit 0`.
#
# Why explicit walking instead of $PPID: hook and Bash-tool shells are transient — their
# ppid chain is the ONLY route to the long-lived `claude` process, and drift-detect.sh's
# header already documents that raw $PPID differs across processes of one session.

# Echo the pid of the nearest `claude` ancestor of $1 (default: current shell).
# Matches either the executable basename (`claude`) or a `claude` token in argv
# (covers `node /path/to/claude` launcher shapes). Returns 1 at pid 0/1 without a match.
resolve_claude_pid() {
  local pid="${1:-$$}" comm args
  while [ -n "$pid" ] && [ "$pid" -gt 1 ] 2>/dev/null; do
    comm=$(ps -o comm= -p "$pid" 2>/dev/null) || return 1
    case "${comm##*/}" in claude) printf '%s\n' "$pid"; return 0 ;; esac
    args=$(ps -o command= -p "$pid" 2>/dev/null) || return 1
    case " $args" in
      *" claude"|*"/claude") printf '%s\n' "$pid"; return 0 ;;
      *"/claude "*|*" claude "*) printf '%s\n' "$pid"; return 0 ;;
    esac
    pid=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d '[:space:]') || return 1
  done
  return 1
}

bridge_file() { printf '/tmp/claude-session-coord-pid-%s.sid\n' "$1"; }

# Echo the session_id for the current process tree (bridge written by register).
resolve_session_id() {
  local cpid f
  cpid=$(resolve_claude_pid) || return 1
  f=$(bridge_file "$cpid")
  [ -r "$f" ] || return 1
  cat "$f" 2>/dev/null
}
