#!/usr/bin/env bash
# PreToolUse — a TRIPWIRE (not an airtight control) for an IMMEDIATE PR merge issued as a
# literal `gh pr merge` (Bash, without --auto) or the mcp__github__merge_pull_request tool.
# Landing a PR is the irreversible step (squash-merge to protected `main` auto-deploys to
# Railway) — this project's policy is that a human runs the actual merge, not an agent,
# UNLESS the PR is already auto-merge-ARMED via `gh pr merge --auto` (the established
# /todo guard-eligible path — see scripts/todo-automerge-guard.sh). `--auto` only ARMS
# GitHub's native auto-merge; it does not merge anything itself — GitHub merges later,
# unattended, once required checks pass. That distinction is the carve-out this hook
# preserves.
#
# Incident: PR #626 (2026-07-14) — the `land` skill's own wording told the agent to
# "review, then merge, autonomously" and its step 4 was literally `gh pr merge`, for an
# ordinary (non-/todo) PR. The agent complied and merged without human sign-off. THE FIX
# for that root cause is `.claude/skills/land/SKILL.md`'s corrected wording (review, fix,
# push, then stop) — this hook only catches the literal-command recurrence of the exact
# same mistake. It is NOT a security boundary: a command-string matcher against a
# Turing-complete shell cannot be one. Confirmed non-exhaustive by review (`gh api`/`curl`
# hitting the same REST/GraphQL endpoint, `bash -c "..."`, an alias, or simply `Edit`-ing
# this very file — nothing gates edits to `.claude/hooks/*`) all reach the same outcome
# ungated. Real enforcement against a determined-or-rationalizing agent needs a
# server-side control (GitHub branch protection) that the agent cannot edit around — that
# is a deliberate, human-made repo-settings decision, not something this hook attempts or
# substitutes for.
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
    # Strip an unquoted trailing shell comment — bash never executes text after it, so it
    # must not influence detection either (a `# --auto` comment must not fake out the arm
    # check below).
    CMD_BARE=$(printf '%s' "$CMD_BARE" | sed -E 's/(^|[[:space:]])#.*$//')
    # Examine each shell-separated segment independently — a single Bash call can chain
    # multiple invocations (; && || | subshell-open), and each `gh pr merge` in it must be
    # judged on its OWN --auto status, not the line as a whole: a decoy --auto sitting in
    # an unrelated segment must not arm a merge segment that lacks it.
    DENY=0
    while IFS= read -r seg; do
      [ -z "$seg" ] && continue
      grep -Eq '(^|[[:space:]])gh[[:space:]]+pr[[:space:]]+merge([[:space:]]|$)' <<< "$seg" || continue
      # A read-only invocation never merges anything — never deny it (no equivalent escape
      # otherwise exists for an agent that just wants to check `gh pr merge`'s flags).
      grep -Eq -- '(^|[[:space:]])(--help|-h)([[:space:]]|$)' <<< "$seg" && continue
      # --auto must appear WITHIN this segment to arm-not-merge; otherwise THIS invocation denies.
      grep -Eq -- '--auto\b' <<< "$seg" && continue
      DENY=1
    done <<< "$(tr ';&|(' '\n\n\n\n' <<< "$CMD_BARE")"
    [ "$DENY" -eq 1 ] || exit 0
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
