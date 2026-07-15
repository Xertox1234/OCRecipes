#!/usr/bin/env bash
# PreToolUse — hard-block an IMMEDIATE PR merge (Bash `gh pr merge` without --auto, OR the
# mcp__github__merge_pull_request tool) unless an explicit override is set. Landing a PR is
# the irreversible step (squash-merge to protected `main` auto-deploys to Railway) — this
# project's policy is that a human runs the actual merge, not an agent, UNLESS the PR is
# already auto-merge-ARMED via `gh pr merge --auto` (the established /todo guard-eligible
# path — see scripts/todo-automerge-guard.sh). `--auto` only ARMS GitHub's native
# auto-merge; it does not merge anything itself — GitHub merges later, unattended, once
# required checks pass. That distinction is exactly the carve-out this hook preserves.
#
# Incident: PR #626 (2026-07-14) — the `land` skill's own wording told the agent to
# "review, then merge, autonomously" and its step 4 was literally `gh pr merge`, for an
# ordinary (non-/todo) PR. The agent complied and merged without human sign-off. A
# memory-only policy (recall it next time) already existed and did not prevent this — an
# explicit instruction sitting at the point of action beat it. This hook is the
# deterministic backstop; `.claude/skills/land/SKILL.md` wording was also corrected to
# match, but don't rely on wording alone — that's the lesson.
#
# Escape (explicitly authorized direct merge): set ALLOW_DIRECT_MERGE=1 in the shell that
# launched Claude Code.
set -uo pipefail

[ -n "${ALLOW_DIRECT_MERGE:-}" ] && exit 0

INPUT=$(cat)
TOOL=$(printf '%s' "$INPUT" | jq -re '.tool_name' 2>/dev/null) || exit 0

case "$TOOL" in
  Bash)
    CMD=$(printf '%s' "$INPUT" | jq -re '.tool_input.command' 2>/dev/null) || exit 0
    # Strip quoted spans first, so `gh pr merge` mentioned inside a quoted argument (a
    # commit message, an echo/grep string) is never mistaken for a real invocation.
    CMD_BARE=$(printf '%s' "$CMD" | sed "s/'[^']*'//g; s/\"[^\"]*\"//g")
    # Match `gh pr merge` only when `gh` is in command position (start-of-command or after
    # a shell separator: ; & | ().
    printf '%s' "$CMD_BARE" | grep -Eq '(^|[;&|(])[[:space:]]*gh[[:space:]]+pr[[:space:]]+merge([[:space:]]|$)' || exit 0
    # `--auto` ARMS auto-merge (GitHub merges later, unattended) — the already-gated /todo
    # path. Anything without it is an immediate merge — block.
    printf '%s' "$CMD_BARE" | grep -Eq -- '--auto\b' && exit 0
    ;;
  mcp__github__merge_pull_request)
    : # this tool always merges immediately — there is no "arm for later" mode for it.
    ;;
  *)
    exit 0   # any other tool — not a merge, allow.
    ;;
esac

REASON="Blocked: a direct/immediate PR merge requires a human. Project policy (incident: PR #626, 2026-07-14) is that an agent reviews, fixes, codifies, and pushes — then STOPS and hands the merge to the human, unless the PR is /todo guard-eligible and auto-merge is being ARMED via \`gh pr merge --auto\` (that path stays open). Ask the user to run \`gh pr merge\` themselves, or set ALLOW_DIRECT_MERGE=1 if they've explicitly authorized a direct merge for this session."

jq -n --arg r "$REASON" '{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": $r
  }
}'
exit 0
