#!/usr/bin/env bash
# scripts/verify-branch-merged.sh <branch> — exit 0 ONLY if the branch's PR state
# is MERGED at a FRESH gh read. Fail-closed: any other state, no PR, or gh failure
# → exit 1. Called by /todo Phase 0 immediately before EACH branch deletion — the
# batch snapshot selects candidates, this gates the actual delete (a snapshot can
# go stale mid-run: the PR #520 incident class).
# Spec: docs/superpowers/specs/2026-07-17-git-guardrails-design.md §3.3.
# Tests: scripts/__tests__/verify-branch-merged.test.ts
set -uo pipefail

BRANCH="${1:-}"
if [ -z "$BRANCH" ]; then
  echo "usage: verify-branch-merged.sh <branch>" >&2
  exit 2
fi

if ! STATE=$(gh pr view "$BRANCH" --json state -q .state 2>/dev/null); then
  echo "verify-branch-merged: no PR found or gh failed for '$BRANCH' — NOT safe to delete" >&2
  exit 1
fi

if [ "$STATE" = "MERGED" ]; then
  echo "verify-branch-merged: '$BRANCH' is MERGED — safe to delete"
  exit 0
fi

echo "verify-branch-merged: '$BRANCH' PR state is '$STATE' (not MERGED) — NOT safe to delete" >&2
exit 1
