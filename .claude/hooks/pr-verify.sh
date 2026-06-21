#!/usr/bin/env bash
# PostToolUse(Bash) — after a gh pr write command, re-read PR state and inject
# verified values as additionalContext so Claude reports from source, not memory.
# NEVER blocks: always exits 0.
set -uo pipefail

INPUT=$(cat)
TOOL=$(printf '%s' "$INPUT" | jq -re '.tool_name' 2>/dev/null) || exit 0

SUBCOMMAND=""
PR_REF=""

if [ "$TOOL" = "Bash" ]; then
  CMD=$(printf '%s' "$INPUT" | jq -re '.tool_input.command' 2>/dev/null) || exit 0
  # Match write-side gh pr commands only (not gh pr view/list/checks/etc).
  printf '%s' "$CMD" | grep -Eq '(^|[[:space:]])gh[[:space:]]+pr[[:space:]]+(create|merge|close|edit)([[:space:]]|$)' || exit 0
  # For create: no PR number exists yet, use no-args (resolves from current branch).
  # For merge/close/edit: extract the PR number from the command and pass it
  # explicitly — no-args would return the current branch's PR (wrong after
  # --delete-branch or when operating on a different branch's PR by number).
  SUBCOMMAND=$(printf '%s' "$CMD" | grep -oE 'gh[[:space:]]+pr[[:space:]]+(create|merge|close|edit)' | grep -oE '(create|merge|close|edit)' | head -1)
  if [ "$SUBCOMMAND" != "create" ]; then
    PR_REF=$(printf '%s' "$CMD" | grep -oE '(^|[[:space:]])[0-9]+' | grep -oE '[0-9]+' | head -1)
  fi
elif [ "$TOOL" = "mcp__github__create_pull_request" ]; then
  # The MCP create tool is the preferred PR-creation path (see CLAUDE.md). It
  # behaves like `gh pr create`: the new PR is on the current branch, so re-read
  # it from source with no-args `gh pr view` (matching the Bash create path).
  # The MCP tool_response shape is server-specific, so re-derive rather than
  # parse it — and the verified-from-source message is the whole point here.
  SUBCOMMAND="create"
else
  exit 0
fi

if [ -n "$PR_REF" ]; then
  PR_JSON=$(gh pr view "$PR_REF" --json number,url,state,title 2>/dev/null)
  GH_EXIT=$?
else
  PR_JSON=$(gh pr view --json number,url,state,title 2>/dev/null)
  GH_EXIT=$?
fi

if [ $GH_EXIT -eq 0 ] && [ -n "$PR_JSON" ]; then
  NUM=$(printf '%s' "$PR_JSON" | jq -r '.number' 2>/dev/null || echo "?")
  URL=$(printf '%s' "$PR_JSON" | jq -r '.url' 2>/dev/null || echo "?")
  STATE=$(printf '%s' "$PR_JSON" | jq -r '.state' 2>/dev/null || echo "?")
  TITLE=$(printf '%s' "$PR_JSON" | jq -r '.title' 2>/dev/null || echo "?")
  MSG="PR state verified post-command — #${NUM}, url: ${URL}, state: ${STATE}, title: \"${TITLE}\". Use these values when reporting, not values from prior context."
else
  MSG="WARNING: could not verify PR state after command (gh pr view failed). Run \`gh pr view\` manually before reporting PR details."
fi

jq -n --arg m "$MSG" '{
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": $m
  }
}'
exit 0
