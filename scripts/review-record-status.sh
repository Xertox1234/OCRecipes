#!/usr/bin/env bash
# Which review records bind a PR's head, and which would block its merge — by the merge gate's rules.
#
# usage: bash scripts/review-record-status.sh <pr-number>
#
# Prints four lines (a value may be empty):
#   head_sha=<the PR's head sha, from gh>
#   digest=<the gate's file-scope digest: gh pr diff --name-only | sed '/^$/d' | LC_ALL=C sort -u | shasum | cut -c1-16>
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
. "$ROOT/.claude/hooks/lib/gh-pr-rest.sh"

# `gh pr view --json` is GraphQL, which a Claude Code cloud session refuses: retry over REST.
HEAD_SHA=$(gh pr view "$PR" --json headRefOid -q .headRefOid 2>/dev/null) \
  || HEAD_SHA=$(gh_pr_rest_json "$PR" 2>/dev/null | jq -r '.headRefOid // empty' 2>/dev/null) \
  || HEAD_SHA=""
# The changed-file names, as the gate reads them: `gh pr diff --name-only`. GitHub refuses a diff
# over 20,000 lines ("PullRequest.diff too_large", #1974), names included. On THAT answer only,
# read the names from the REST file list, which has no line cap: a renamed file is listed under
# its new name there, as in the diff. The list stops at 3,000 files, so one that long may be cut
# and is not trusted. Every other failure is still "could not read" (exit 3 below). The gate
# itself diffs locally in that case (merge-review-guard.sh pr_diff); if the two ever name a
# rename differently the digests differ and match= is empty, which sends the caller to a
# fresh review, never past one.
pr_files() {
  local err out n
  err=$(mktemp "${TMPDIR:-/tmp}/review-record-status-XXXXXX") || return 1
  if out=$(gh pr diff "$PR" --name-only 2>"$err"); then
    rm -f "$err"; printf '%s\n' "$out"; return 0
  fi
  if ! grep -q 'PullRequest.diff too_large' "$err"; then rm -f "$err"; return 1; fi
  rm -f "$err"
  out=$(gh api --paginate "repos/{owner}/{repo}/pulls/$PR/files?per_page=100" \
    --jq '.[].filename' 2>/dev/null) || return 1
  n=$(printf '%s\n' "$out" | sed '/^$/d' | wc -l | tr -d ' ')
  [ "$n" -gt 0 ] && [ "$n" -lt 3000 ] || return 1
  printf '%s\n' "$out"
}
FILES=$(pr_files) || FILES=""
if [ -z "$HEAD_SHA" ] || [ -z "$FILES" ]; then
  echo "review-record-status: gh could not read PR #$PR's head or changed files" >&2
  exit 3
fi
DIGEST=$(printf '%s\n' "$FILES" | sed '/^$/d' | LC_ALL=C sort -u | shasum | cut -c1-16)
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
