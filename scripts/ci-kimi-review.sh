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
#   KIMI_REVIEW_PATTERNS - comma-separated pattern list passed to kimi-review;
#                          auto-derived from changed paths when unset
#   KIMI_REVIEW_PATTERN_MAX_CHARS - per-pattern context cap, default 12000
#   KIMI_REVIEW_TIMEOUT_SECONDS - timeout for the review command, default 180

set -uo pipefail

base_sha="${KIMI_REVIEW_BASE_SHA:-}"
head_sha="${KIMI_REVIEW_HEAD_SHA:-}"
review_scope="${KIMI_REVIEW_SCOPE:-CI PR diff}"
review_patterns="${KIMI_REVIEW_PATTERNS:-}"
pattern_max_chars="${KIMI_REVIEW_PATTERN_MAX_CHARS:-12000}"
timeout_seconds="${KIMI_REVIEW_TIMEOUT_SECONDS:-180}"

if [[ -z "$base_sha" || -z "$head_sha" ]]; then
  echo "::error title=Missing diff range::KIMI_REVIEW_BASE_SHA and KIMI_REVIEW_HEAD_SHA are required."
  exit 1
fi

if ! changed_files=$(git diff --name-only --diff-filter=ACM "$base_sha" "$head_sha"); then
  echo "::error title=Unable to compute changed files::Could not diff $base_sha..$head_sha."
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

if command -v kimi-review >/dev/null 2>&1; then
  reviewer_command=(kimi-review)
elif [[ -f scripts/kimi-review.py ]]; then
  reviewer_command=(python3 scripts/kimi-review.py)
else
  echo "::error title=kimi-review missing::Provision the kimi-review CLI or keep scripts/kimi-review.py available."
  exit 1
fi

if [[ -z "$review_patterns" ]]; then
  add_pattern() {
    case ",$review_patterns," in
      *,$1,*) ;;
      *) review_patterns="${review_patterns:+$review_patterns,}$1" ;;
    esac
  }

  while IFS= read -r file; do
    case "$file" in
      server/routes/*)
        add_pattern api; add_pattern security; add_pattern architecture ;;
      server/storage/*|shared/schema.ts|migrations/*)
        add_pattern database; add_pattern security; add_pattern architecture ;;
      server/middleware/*)
        add_pattern security; add_pattern api ;;
      server/services/photo-analysis.ts|server/services/nutrition-coach.ts|server/services/recipe-chat.ts|server/services/recipe-generation.ts)
        add_pattern ai-prompting; add_pattern architecture ;;
      evals/*)
        add_pattern ai-prompting; add_pattern testing ;;
      server/services/*)
        add_pattern architecture ;;
      client/screens/*|client/navigation/*)
        add_pattern react-native; add_pattern design-system; add_pattern accessibility ;;
      client/components/*)
        add_pattern react-native; add_pattern design-system; add_pattern accessibility; add_pattern performance ;;
      client/hooks/*)
        add_pattern hooks; add_pattern client-state; add_pattern react-native; add_pattern accessibility ;;
      client/context/*)
        add_pattern client-state ;;
      client/lib/*)
        add_pattern client-state ;;
      client/constants/theme.ts|design_guidelines.md)
        add_pattern design-system ;;
      .github/workflows/*)
        add_pattern architecture; add_pattern testing ;;
      vitest.config.*|eslint.config.*)
        add_pattern testing; add_pattern typescript ;;
      *.test.ts|*.test.tsx|*.spec.ts|*.spec.tsx|*/__tests__/*)
        add_pattern testing ;;
    esac
    case "$file" in
      *.ts|*.tsx) add_pattern typescript ;;
    esac
  done <<< "$changed_files"
fi

review_command=(
  "${reviewer_command[@]}"
  --scope "$review_scope"
  --tiers CRITICAL,WARNING
  --profile ocrecipes
)

if [[ -n "$review_patterns" ]]; then
  review_command+=(--patterns "$review_patterns" --rules "$review_patterns" --pattern-max-chars "$pattern_max_chars")
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