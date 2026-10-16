#!/usr/bin/env bash
# scripts/oc-worktree.sh — create an ad-hoc OCRecipes worktree on the U34Bolt drive.
#
# usage: oc-worktree.sh <branch> [<base>]   (base defaults to origin/main)
#   - existing local branch  → checked out as-is
#   - branch only on origin  → checked out tracking origin/<branch>
#   - otherwise              → new branch from <base>, no upstream
# Refuses (exit 1) unless the drive root is itself a mount point — a plain
# directory there is a phantom on the internal disk. /todo worktrees are NOT made
# here: they stay under <main>/.claude/worktrees (the isolation guards key on it).
# Spec: docs/superpowers/specs/2026-10-14-external-drive-design.md §4.
# Tests: scripts/__tests__/oc-worktree.test.ts
set -euo pipefail

usage() {
  echo "usage: oc-worktree.sh <branch> [<base>]" >&2
  exit 2
}

DRIVE="${OC_DRIVE_ROOT:-/Volumes/U34Bolt}"
WT_ROOT="${OC_WORKTREES_DIR:-$DRIVE/OCRecipes/worktrees}"
BRANCH="${1:-}"
BASE="${2:-origin/main}"
[ -n "$BRANCH" ] || usage

mount_point_of() { df -P "$1" 2>/dev/null | awk 'NR==2{print $6}'; }
if [ "$(mount_point_of "$DRIVE")" != "$DRIVE" ]; then
  echo "oc-worktree: $DRIVE is not mounted — refusing (it would write to the internal disk)" >&2
  exit 1
fi

SLUG=$(printf '%s' "$BRANCH" | tr '/' '-' | tr -c 'A-Za-z0-9._-' '-')
DEST="$WT_ROOT/$SLUG"
if [ -e "$DEST" ]; then
  echo "oc-worktree: $DEST already exists — refusing" >&2
  exit 1
fi

COMMON=$(git rev-parse --path-format=absolute --git-common-dir)
MAIN="${COMMON%/.git}"

mkdir -p "$WT_ROOT"
if git -C "$MAIN" show-ref --verify --quiet "refs/heads/$BRANCH"; then
  git -C "$MAIN" worktree add "$DEST" "$BRANCH"
elif git -C "$MAIN" show-ref --verify --quiet "refs/remotes/origin/$BRANCH"; then
  git -C "$MAIN" worktree add --track -b "$BRANCH" "$DEST" "origin/$BRANCH"
else
  git -C "$MAIN" worktree add --no-track -b "$BRANCH" "$DEST" "$BASE"
fi

# Ad-hoc worktrees get their own node_modules (~1 GB on the drive) — worktree-deps.sh
# deliberately symlinks only harness-managed worktrees.
if [ "${OC_SKIP_NPM_CI:-0}" != "1" ]; then
  (cd "$DEST" && npm ci)
fi

if [ -n "${CLAUDE_CODE_SESSION_ID:-}" ]; then
  bash "$MAIN/scripts/declare-worktree.sh" "$DEST"
else
  echo "oc-worktree: not in a Claude session — no worktree contract declared"
fi

echo "$DEST"
