#!/usr/bin/env bash
# todo-automerge-guard.sh — fail-CLOSED gate for unattended /todo PR auto-merges.
#
# Auto-merge is allowed ONLY if EVERY changed file is on the known-safe allowlist.
# Any file outside it — including paths we never anticipated — forces a HOLD for
# human review. This is the opposite of a denylist (which would silently merge
# anything you forgot to enumerate). The "low priority" label on a todo is
# self-assigned; this script is the backstop that catches a mislabel before it
# lands on main while you're asleep.
#
# Usage:  scripts/todo-automerge-guard.sh <pr-number>
# Exit 0 = OK to auto-merge   |   Exit 1 = HOLD for human review
set -euo pipefail

PR="${1:?usage: todo-automerge-guard.sh <pr-number>}"

# Known-safe surfaces for unattended low-priority merges. Deliberately TIGHT —
# broaden only as you build trust in the harness. Mirrors the "do not delegate"
# boundary documented in todos/TEMPLATE.md (auth, IAP, schema, secrets, health).
# A file is "safe" only if it matches one of these; otherwise the PR is HELD.
SAFE_REGEX='^client/components/|^client/screens/|^client/constants/|(^|/)__tests__/|(-|\.)utils\.ts$|\.test\.tsx?$|^docs/|^todos/'

files="$(gh pr diff "$PR" --name-only)"
if [ -z "$files" ]; then
  echo "guard: HOLD PR #$PR — no file changes (nothing to merge)"
  exit 1
fi

unsafe="$(printf '%s\n' "$files" | grep -vE "$SAFE_REGEX" || true)"
if [ -n "$unsafe" ]; then
  echo "guard: HOLD PR #$PR — changes files outside the auto-merge allowlist:"
  printf '  %s\n' "$unsafe"
  echo "Review these by hand; do not auto-merge."
  exit 1
fi

echo "guard: OK PR #$PR — every changed file is on the safe allowlist"
exit 0
