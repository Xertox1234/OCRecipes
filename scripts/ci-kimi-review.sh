#!/usr/bin/env bash
# CI gate for kimi-review over pull request TypeScript diffs.
#
# Required env:
#   KIMI_REVIEW_BASE_SHA - base commit SHA for the diff
#   KIMI_REVIEW_HEAD_SHA - head commit SHA for the diff
#   WORKER_API_KEY or MOONSHOT_API_KEY - API credential used by kimi-review
#
# Optional env:
#   KIMI_REVIEW_SCOPE - review scope label
#   KIMI_REVIEW_PATTERNS - comma-separated pattern list passed to kimi-review
#   KIMI_REVIEW_TIMEOUT_SECONDS - timeout for the review command, default 180

set -uo pipefail

base_sha="${KIMI_REVIEW_BASE_SHA:-}"
head_sha="${KIMI_REVIEW_HEAD_SHA:-}"
review_scope="${KIMI_REVIEW_SCOPE:-CI PR diff}"
review_patterns="${KIMI_REVIEW_PATTERNS:-}"
timeout_seconds="${KIMI_REVIEW_TIMEOUT_SECONDS:-180}"

if [[ -z "$base_sha" || -z "$head_sha" ]]; then
  echo "::error title=Missing diff range::KIMI_REVIEW_BASE_SHA and KIMI_REVIEW_HEAD_SHA are required."
  exit 1
fi

if ! review_diff=$(git diff --diff-filter=ACM "$base_sha" "$head_sha" -- '*.ts' '*.tsx'); then
  echo "::error title=Unable to compute diff::Could not diff $base_sha..$head_sha."
  exit 1
fi

if [[ -z "$review_diff" ]]; then
  echo "No TypeScript diff for kimi-review."
  exit 0
fi

if [[ -z "${WORKER_API_KEY:-}" && -z "${MOONSHOT_API_KEY:-}" ]]; then
  echo "::error title=Missing Kimi credentials::Set WORKER_API_KEY or MOONSHOT_API_KEY as a repository secret."
  exit 1
fi

if ! command -v kimi-review >/dev/null 2>&1; then
  echo "::error title=kimi-review missing::Provision the kimi-review CLI on this runner before enabling KIMI_REVIEW_CI_ENABLED."
  exit 1
fi

review_command=(
  kimi-review
  --scope "$review_scope"
  --tiers CRITICAL,WARNING
  --profile ocrecipes
)

if [[ -n "$review_patterns" ]]; then
  review_command+=(--patterns "$review_patterns")
fi

if command -v timeout >/dev/null 2>&1; then
  review_raw=$(printf '%s' "$review_diff" | NO_COLOR=1 timeout "$timeout_seconds" "${review_command[@]}" 2>&1)
  review_status=$?
else
  review_raw=$(printf '%s' "$review_diff" | NO_COLOR=1 "${review_command[@]}" 2>&1)
  review_status=$?
fi

review_output=$(printf '%s' "$review_raw" | sed $'s/\x1b\\[[0-9;]*m//g')

printf '%s\n' "$review_output"

critical_findings=$(printf '%s\n' "$review_output" \
  | grep -E '[[]CRITICAL[]].*[^[:space:]]' \
  | grep -ivE '[[]CRITICAL[]][^[:alnum:]]*no findings' || true)

if [[ -n "$critical_findings" ]]; then
  echo "" >&2
  echo "Kimi review blocked this PR: CRITICAL finding present." >&2
  exit 1
fi

if [[ $review_status -eq 124 ]]; then
  echo "::error title=kimi-review timed out::kimi-review timed out after ${timeout_seconds}s."
  exit 1
fi

if [[ $review_status -ne 0 ]]; then
  echo "::error title=kimi-review failed::kimi-review exited with status $review_status."
  exit "$review_status"
fi

echo "kimi-review completed without CRITICAL findings."