#!/usr/bin/env bash
set -euo pipefail

run_id="${1:-}"

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI is required to fetch CI logs." >&2
  exit 1
fi

if [[ -z "$run_id" ]]; then
  branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)"
  run_id="$(gh run list \
    --workflow CI \
    --branch "$branch" \
    --status failure \
    --limit 1 \
    --json databaseId \
    --jq '.[0].databaseId // empty')"
fi

if [[ -z "$run_id" ]]; then
  run_id="$(gh run list \
    --workflow CI \
    --status failure \
    --limit 1 \
    --json databaseId \
    --jq '.[0].databaseId // empty')"
fi

if [[ -z "$run_id" ]]; then
  echo "No failed CI run found. Pass a run id explicitly: scripts/ci-failed-logs.sh <run-id>" >&2
  exit 1
fi

gh run view "$run_id" --log-failed
