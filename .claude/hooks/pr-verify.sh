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
  # Cheap pre-guard: `gh` is a NECESSARY substring of any gh-pr match (quote-blanking only removes
  # characters, never inserts them) — skip the scan otherwise. Safe: this hook is NON-blocking.
  case "$CMD" in *gh*) : ;; *) exit 0 ;; esac
  # Detect a WRITE-side gh pr command (create|merge|close|edit) via the shared, quote-AWARE
  # scanner (.claude/hooks/lib/cmd-detect.sh) — the single source of the strip + matcher across
  # the PR/commit hooks. This fixes the apostrophe-glue miss and the first-number-wins PR-number
  # bug (`timeout 30 gh pr merge 42` used to resolve 30) of the 2026-07-18 audit /code-review.
  # Lib UNSOURCEABLE → exit 0 (silent), the safe direction for this non-blocking verifier.
  HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  . "$HERE/lib/cmd-detect.sh" 2>/dev/null && declare -F cmd_gh_pr_write_subcommand >/dev/null || exit 0
  SUBCOMMAND=$(cmd_gh_pr_write_subcommand "$CMD")
  [ -n "$SUBCOMMAND" ] || exit 0
  # For create: no PR number exists yet — no-args gh pr view resolves from the current branch.
  # For merge/close/edit: pass the number that FOLLOWS the subcommand (never the first number
  # anywhere) — no-args would return the current branch's PR, wrong after --delete-branch or when
  # operating on another branch's PR by number.
  if [ "$SUBCOMMAND" != "create" ]; then
    PR_REF=$(cmd_gh_pr_number "$CMD")
  fi
elif [ "$TOOL" = "mcp__github__create_pull_request" ]; then
  # The MCP create tool is the preferred PR-creation path (see CLAUDE.md). It
  # behaves like `gh pr create`: the new PR is on the current branch, so re-read
  # it from source with no-args `gh pr view` (matching the Bash create path).
  # The MCP tool_response shape is server-specific, so re-derive rather than
  # parse it — and the verified-from-source message is the whole point here.
  SUBCOMMAND="create"
elif [ "$TOOL" = "mcp__github__merge_pull_request" ]; then
  # The MCP merge tool is the CLAUDE.md-preferred merge path. Its input carries the
  # PR number explicitly — use it (no-args gh pr view would resolve the current
  # branch's PR, wrong after a squash-merge deletes the branch).
  SUBCOMMAND="merge"
  PR_REF=$(printf '%s' "$INPUT" | jq -re '.tool_input.pullNumber // empty' 2>/dev/null || echo "")
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
