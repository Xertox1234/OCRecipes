#!/usr/bin/env bash
# scripts/verify-branch-merged.sh <branch> — exit 0 ONLY if the branch's PR is
# MERGED at a FRESH gh read AND every existing local/remote-tracking ref of the
# branch sits exactly at the PR's headRefOid. Fail-closed: any other state, no
# PR, gh/jq failure, or a tip≠PR-head mismatch → exit 1. The oid check matters
# because MERGED alone lies after a squash-merge: a squash-merged PR followed by
# one new local commit still reports MERGED, and deleting would destroy the
# post-merge work (documented incident class in this repo). merge-base
# --is-ancestor cannot express this — squash merges never contain the branch tip.
# Called by /todo Phase 0 immediately before EACH branch deletion — the batch
# snapshot selects candidates, this gates the actual delete (a snapshot can go
# stale mid-run: the PR #520 incident class).
# Spec: docs/superpowers/specs/2026-07-17-git-guardrails-design.md §3.3.
# Tests: scripts/__tests__/verify-branch-merged.test.ts
set -uo pipefail

BRANCH="${1:-}"
if [ -z "$BRANCH" ]; then
  echo "usage: verify-branch-merged.sh <branch>" >&2
  exit 2
fi
case "$BRANCH" in -*)
  echo "verify-branch-merged: flag-like branch name '$BRANCH' — NOT safe to delete" >&2
  exit 1 ;;
esac

if ! PR_JSON=$(gh pr view "$BRANCH" --json state,headRefOid 2>/dev/null); then
  echo "verify-branch-merged: no PR found or gh failed for '$BRANCH' — NOT safe to delete" >&2
  exit 1
fi
STATE=$(printf '%s' "$PR_JSON" | jq -r '.state // empty' 2>/dev/null || echo "")
HEAD_OID=$(printf '%s' "$PR_JSON" | jq -r '.headRefOid // empty' 2>/dev/null || echo "")

if [ "$STATE" != "MERGED" ]; then
  echo "verify-branch-merged: '$BRANCH' PR state is '$STATE' (not MERGED) — NOT safe to delete" >&2
  exit 1
fi
if [ -z "$HEAD_OID" ]; then
  echo "verify-branch-merged: PR headRefOid unavailable for '$BRANCH' — NOT safe to delete" >&2
  exit 1
fi

for REF in "refs/heads/$BRANCH" "refs/remotes/origin/$BRANCH"; do
  TIP=$(git rev-parse -q --verify "$REF" 2>/dev/null || echo "")
  [ -n "$TIP" ] || continue
  if [ "$TIP" != "$HEAD_OID" ]; then
    echo "verify-branch-merged: $REF is at ${TIP} but the merged PR head is ${HEAD_OID} (post-merge commits?) — NOT safe to delete" >&2
    exit 1
  fi
done

echo "verify-branch-merged: '$BRANCH' is MERGED at its PR head — safe to delete"
exit 0
