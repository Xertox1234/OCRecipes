#!/usr/bin/env bash
# Does a todo PR carry a passing todo-verifier record? Read by scripts/todo-automerge-guard.sh.
#
# usage: bash scripts/verifier-record-status.sh <pr-number>
#
# Records are written by .claude/hooks/todo-verifier-record-writer.sh from the verifier's own
# reply, keyed to the commit it verified: <review_stamp_dir sha>/verifier/todo-verifier.json.
# The verifier runs at executor Step 6, and Steps 7-9 can still commit (review fixes, the
# archive ticks, codify), so the PR's final head usually has no record. Rule: among the PR's
# commits, the NEWEST one that has a record governs. A later fail beats an earlier pass, and a
# fix verified after a fail passes. Commits after the governing one are not verified; their
# number is printed as later_commits (residual: docs/harness-residuals.md).
#
# Passing = verdict pass or none, not_met 0 and criteria_edited "no" (the same predicate as the
# writer's). Anything else, an unreadable record included, holds.
#
# Prints one line: verifier=<verdict|none|unreadable> sha=<governing sha> not_met=<n>
#   criteria_edited=<v> later_commits=<n>
# Exit 0 = passing record, 1 = hold (no record, or not passing), 2 = bad usage,
# 3 = gh could not list the PR's commits (the caller treats this as an error, never a pass).
set -uo pipefail

PR="${1:-}"
case "$PR" in
  '' | *[!0-9]*) echo "usage: bash scripts/verifier-record-status.sh <pr-number>" >&2; exit 2 ;;
esac

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/.claude/hooks/lib/review-stamp-path.sh"

# Oldest first, as GitHub returns them. Capped at 250 commits by the API, far above a todo PR.
COMMITS=$(gh api "repos/{owner}/{repo}/pulls/$PR/commits?per_page=100" --paginate --jq '.[].sha' 2>/dev/null) \
  || { echo "verifier-record-status: gh could not list PR #$PR's commits" >&2; exit 3; }
COMMITS=$(sed '/^$/d' <<<"$COMMITS")
if [ -z "$COMMITS" ] || grep -qvE '^[0-9a-f]{40}$' <<<"$COMMITS"; then
  echo "verifier-record-status: PR #$PR's commit list is empty or malformed" >&2
  exit 3
fi

# Newest first. awk, not `tail -r`, which GNU coreutils lacks.
NEWEST_FIRST=$(awk '{ a[NR] = $0 } END { for (i = NR; i > 0; i--) print a[i] }' <<<"$COMMITS")

GOV="" REC="" LATER=0
while IFS= read -r sha; do
  # Anchored to this repo, as the writer is: the key comes from git's common dir.
  f="$(cd "$ROOT" && review_stamp_dir "$sha")/verifier/todo-verifier.json"
  if [ -e "$f" ]; then GOV="$sha"; REC="$f"; break; fi
  LATER=$((LATER + 1))
done <<<"$NEWEST_FIRST"

if [ -z "$GOV" ]; then
  echo "verifier=none sha= not_met= criteria_edited= later_commits=$LATER"
  exit 1
fi

PASSING='(.verdict == "pass" or .verdict == "none") and .not_met == 0 and .criteria_edited == "no"'
LINE=$(jq -r --arg s "$GOV" --argjson n "$LATER" \
  '"verifier=\(.verdict // "unknown") sha=\($s) not_met=\(.not_met // "") criteria_edited=\(.criteria_edited // "") later_commits=\($n)"' \
  "$REC" 2>/dev/null) || LINE=""
if [ -z "$LINE" ]; then
  echo "verifier=unreadable sha=$GOV not_met= criteria_edited= later_commits=$LATER"
  exit 1
fi
echo "$LINE"
jq -e --arg s "$GOV" ".head_sha == \$s and ($PASSING)" "$REC" >/dev/null 2>&1 || exit 1
exit 0
