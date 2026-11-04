#!/usr/bin/env bash
# Worker for scripts/harness/verdict-diff.sh: judge rows with one version of one guard hook.
#
# usage: guard-eval.sh <hook file> <rows dir> <out dir> <k>...
# Row k is <rows dir>/<k>.cmd (the raw command) and <rows dir>/<k>.cwd. Writes <out dir>/<k> holding
# DENY, ASK, FIRE (additionalContext, the advisory hooks' signal) or ALLOW. Nothing is executed: the
# command reaches the hook as a JSON string. The caller counts the outputs, so a worker that dies
# shows up as a shortfall, never as a quiet ALLOW.
set -uo pipefail
HOOK=$1 ROWS=$2 OUT=$3; shift 3
for k in "$@"; do
  out=$(jq -cn --rawfile c "$ROWS/$k.cmd" --arg d "$(cat "$ROWS/$k.cwd")" --arg s "$VD_SESSION" \
    '{tool_name:"Bash",session_id:$s,cwd:$d,tool_input:{command:$c}}' | bash "$HOOK" 2>/dev/null)
  case "$out" in
    *'"permissionDecision": "deny"'* | *'"permissionDecision":"deny"'*) v=DENY ;;
    *'"permissionDecision": "ask"'* | *'"permissionDecision":"ask"'*) v=ASK ;;
    *'"additionalContext"'*) v=FIRE ;;
    *) v=ALLOW ;;
  esac
  printf '%s\n' "$v" > "$OUT/$k"
done
