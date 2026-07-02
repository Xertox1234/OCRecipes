#!/usr/bin/env bash
# todo-automerge-guard.sh — FAIL-CLOSED batch-merge eligibility check for /todo PRs.
#
# MODEL (since #487 — NO PR ever auto-merges; this script only CLASSIFIES): a /todo PR
# is eligible for the user's batch-merge ONLY if BOTH gates pass:
#   1. TODO GATE — the archived todo riding the PR (todos/archive/<slug>.md) has
#      priority low|medium and no `security` mention in its frontmatter. This lives here,
#      not only in the executor, because a fresh morning session re-running this guard
#      has no overnight MERGE_ELIGIBLE report — the guard is the one artifact every
#      merge path re-runs, so it must enforce the whole policy itself.
#   2. PATH GATE — EVERY changed file is on the known-safe ALLOWLIST and none hits the
#      sensitive override.
# Anything else HOLDs for individual human review — an unanticipated path, and the whole
# sensitive backend (server/storage, server/routes, server/middleware), .github/ (the CI
# gates), scripts/ (incl. this guard), migrations, shared/schema.ts, secrets/certs.
#
# Fail-CLOSED is deliberate: for a merge-eligibility check an UNKNOWN path must mean
# "a human looks", never "ship it". (An earlier denylist revision was found fail-OPEN
# on whole sensitive layers — server/storage, .github, scripts — so this inverts it: a
# path is unsafe unless proven safe.)
#
# To widen the pass: ADD a known-safe prefix to SAFE_ALLOWLIST. If you allowlist a dir
# that also holds a sensitive file (e.g. server/services holds the IAP services), add
# that file to SENSITIVE_OVERRIDE so it still HOLDs. A missed allowlist entry only costs
# a manual merge; never the other way around.
#
# Usage:  scripts/todo-automerge-guard.sh <pr-number>
# Exit 0 = eligible for the user's batch-merge (MERGE_ELIGIBLE: yes) — NOT a merge command
# Exit 1 = HOLD: a changed file is sensitive or not on the allowlist (individual review)
# Exit 2 = ERROR: could not evaluate (gh failure / empty diff) — fail-closed, treat as HOLD
# The caller distinguishes a real HOLD (1) from a tooling error (2): a HOLD means the PR
# needs individual review; an error means eligibility couldn't be decided (e.g. gh unauth).
# Nothing in this script merges anything; the user batch-merges eligible PRs themselves.
set -euo pipefail

PR="${1:?usage: todo-automerge-guard.sh <pr-number>}"

# Known-safe surfaces. A file is batch-merge-eligible only if it matches one of these: UI
# (components/screens/navigation/constants), business-logic services, shared pure
# modules (types / zod-schemas / constants / lib), any test, an extracted *-utils file,
# and docs/todos/markdown. NOTE: server/storage, server/routes, server/middleware,
# migrations/, shared/schema.ts, .github/, scripts/, certs, .env are deliberately ABSENT
# — they HOLD.
SAFE_ALLOWLIST='^client/components/|^client/screens/|^client/navigation/|^client/constants/|^server/services/|^shared/types/|^shared/schemas/|^shared/constants/|^shared/lib/|(^|/)__tests__/|\.test\.[jt]sx?$|\.spec\.[jt]sx?$|(-|\.)utils\.tsx?$|^docs/|^todos/|\.md$'

# Sensitive files that DO live inside an allowlisted dir and must HOLD anyway: the IAP /
# billing surfaces under server/services (receipt-validation, store-notifications,
# subscription-*) and the health-PII onboarding screens under client/screens. Grocery
# "receipt" OCR (receipt-analysis, Receipt*Screen) and notification infra
# (push-notifications, notification-scheduler) are NOT sensitive and must pass.
SENSITIVE_OVERRIDE='receipt-validation|store-notification|(^|/)subscription|(^|/)iap[./-]|apple-?iap|google-?(iap|play)|app-store-server|in-app-purchase|entitlement|(^|/)[Hh]ealth'

files="$(gh pr diff "$PR" --name-only)" || {
  echo "guard: ERROR PR #$PR — could not read changed files (gh error). Fail-closed."
  exit 2
}
if [ -z "$files" ]; then
  echo "guard: ERROR PR #$PR — no file changes (nothing to evaluate)"
  exit 2
fi

# ── TODO GATE ─────────────────────────────────────────────────────────────────
# The todo's priority and labels ride the PR as todos/archive/<slug>.md frontmatter —
# the PR itself carries no GitHub label. Parse it from the PR head. Fail-closed at
# every step: no archived todo in the diff, unreadable content, or a priority other
# than low/medium ⇒ HOLD. Any mention of "security" ANYWHERE in the frontmatter
# (labels, title, …) HOLDs — deliberately broad; a false-positive HOLD only costs a
# manual review, never the other way around.
todo_files="$(printf '%s\n' "$files" | grep -E '^todos/archive/.+\.md$' || true)"
if [ -z "$todo_files" ]; then
  echo "guard: HOLD PR #$PR — no todos/archive/*.md in the diff; cannot verify the todo's priority/labels (fail-closed)"
  echo "Needs individual review; exclude from the batch-merge."
  exit 1
fi
while IFS= read -r tf; do
  [ -z "$tf" ] && continue
  raw="$(gh api -H "Accept: application/vnd.github.raw" "repos/{owner}/{repo}/contents/${tf}?ref=refs/pull/${PR}/head" 2>/dev/null)" || {
    echo "guard: ERROR PR #$PR — could not read ${tf} from the PR head (gh error). Fail-closed."
    exit 2
  }
  # Frontmatter = lines between the first pair of --- markers. Here-strings, not
  # `printf | …` pipes: under pipefail a producer-pipe into an early-exiting consumer
  # can fail open via SIGPIPE (see solutions DB: pipefail-echo-grep-condition).
  fm="$(awk '/^---[[:space:]]*$/{n++; next} n==1' <<< "$raw")"
  prio="$(sed -n 's/^priority:[[:space:]]*//p' <<< "$fm" | head -n1 | tr -d "[:space:]\"'" | tr '[:upper:]' '[:lower:]')"
  case "$prio" in
    low|medium) : ;;
    *)
      echo "guard: HOLD PR #$PR — ${tf} has priority '${prio:-<missing>}'; only low/medium todos are batch-merge-eligible"
      echo "Needs individual review; exclude from the batch-merge."
      exit 1 ;;
  esac
  if grep -qi 'security' <<< "$fm"; then
    echo "guard: HOLD PR #$PR — ${tf} frontmatter mentions 'security'; always individual review"
    echo "Needs individual review; exclude from the batch-merge."
    exit 1
  fi
done <<< "$todo_files"

# ── PATH GATE ─────────────────────────────────────────────────────────────────

# A file passes only if (1) it is on the allowlist and (2) — unless it is a doc/todo/
# markdown file, which is never sensitive CODE — it does not hit the sensitive override.
# ANY other outcome HOLDs: not allowlisted, sensitive, or a grep regex ERROR (rc >= 2).
# Exit codes are captured explicitly so a broken regex (rc 2) can never look like a clean
# "no match" (rc 1) — a typo fails CLOSED, never silently passes as eligible.
unsafe=""
while IFS= read -r f; do
  [ -z "$f" ] && continue
  # 1) must be on the allowlist
  if ! printf '%s' "$f" | grep -qE "$SAFE_ALLOWLIST"; then
    unsafe="${unsafe}  ${f}"$'\n'; continue
  fi
  # 2) docs / todos / markdown are never sensitive code — they pass on the allowlist alone
  #    (a todo slug like subscription-tier-ui.md must not trip the override)
  if printf '%s' "$f" | grep -qE '^(docs|todos)/|\.md$'; then
    continue
  fi
  # 3) an allowlisted CODE file that hits the sensitive override HOLDs. rc 1 (clean no-match)
  #    is the ONLY pass; rc 0 (sensitive) and rc >= 2 (regex error) both HOLD.
  rc_sens=0; printf '%s' "$f" | grep -qE "$SENSITIVE_OVERRIDE" || rc_sens=$?
  if [ "$rc_sens" -ne 1 ]; then
    unsafe="${unsafe}  ${f}"$'\n'
  fi
done <<< "$files"

if [ -n "$unsafe" ]; then
  echo "guard: HOLD PR #$PR — changed files not on the batch-merge allowlist (or sensitive):"
  printf '%s' "$unsafe"
  echo "Needs individual review; exclude from the batch-merge."
  exit 1
fi

echo "guard: OK PR #$PR — every changed file is on the safe allowlist"
exit 0
