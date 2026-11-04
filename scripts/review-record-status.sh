#!/usr/bin/env bash
# Which review records bind a PR's head, and which would block its merge — by the merge gate's rules.
#
# usage: bash scripts/review-record-status.sh <pr-number>
#
# Prints four lines (a value may be empty):
#   head_sha=<the PR's head sha, from gh>
#   digest=<the gate's file-scope digest: gh pr diff --name-only | sed '/^$/d' | sort -u | shasum | cut -c1-16>
#   match=<verdict> <agent_type>    a record for this head, clean or advisory, nothing unresolved, digest equal
#   objecting=<agent> …             records for this head that would deny the merge (not clean/advisory,
#                                   or something unresolved); an unreadable record is named by its file
# Exit 0 on a completed lookup, 2 on bad usage, 3 when gh could not give the head or the file list.
#
# Why a script: the todo-executor ran these checks inline at Step 10, and Claude Code's worktree
# isolation refuses a sourced library and `$` values in a command that names git, but runs
# `bash <file>` (harness diagnosis item 2). The verdict set must equal merge-review-guard.sh's own
# VERDICT test; if that ever changes, change this script in the same PR.
set -uo pipefail

PR="${1:-}"
case "$PR" in
  '' | *[!0-9]*) echo "usage: bash scripts/review-record-status.sh <pr-number>" >&2; exit 2 ;;
esac

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/.claude/hooks/lib/review-stamp-path.sh"

HEAD_SHA=$(gh pr view "$PR" --json headRefOid -q .headRefOid 2>/dev/null) || HEAD_SHA=""
FILES=$(gh pr diff "$PR" --name-only 2>/dev/null) || FILES=""
if [ -z "$HEAD_SHA" ] || [ -z "$FILES" ]; then
  echo "review-record-status: gh could not read PR #$PR's head or changed files" >&2
  exit 3
fi
DIGEST=$(printf '%s\n' "$FILES" | sed '/^$/d' | sort -u | shasum | cut -c1-16)
DIR=$(review_stamp_dir "$HEAD_SHA")

MATCH="" OBJECTING=""
for f in "$DIR"/*.json; do
  [ -f "$f" ] || continue
  # unreadable, or no head_sha: the gate denies on it, so name it by its file
  if ! jq -e '(.head_sha // "") != ""' "$f" >/dev/null 2>&1; then
    OBJECTING="$OBJECTING $(basename "$f" .json)"
    continue
  fi
  jq -e --arg s "$HEAD_SHA" '.head_sha == $s' "$f" >/dev/null 2>&1 || continue
  if jq -e '(.verdict == "clean" or .verdict == "advisory") and ((.unresolved // []) | length) == 0' \
    "$f" >/dev/null 2>&1; then
    [ -z "$MATCH" ] && MATCH=$(jq -r --arg d "$DIGEST" \
      'select(.reviewed_files_digest == $d) | "\(.verdict) \(.agent_type)"' "$f" 2>/dev/null)
  else
    OBJECTING="$OBJECTING $(jq -r '.agent_type // "unknown"' "$f")"
  fi
done

printf 'head_sha=%s\ndigest=%s\nmatch=%s\nobjecting=%s\n' "$HEAD_SHA" "$DIGEST" "$MATCH" "${OBJECTING# }"
