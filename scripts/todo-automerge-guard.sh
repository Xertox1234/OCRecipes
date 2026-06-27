#!/usr/bin/env bash
# todo-automerge-guard.sh — sensitive-path gate for unattended /todo PR auto-merges.
#
# MODEL (changed 2026-06-26, PR #465): low/medium todos auto-merge on green CI by
# default ("free pass"). This guard HOLDs a PR for human review ONLY when its diff
# touches the "do-not-delegate" boundary — auth, IAP/billing/subscriptions, the DB
# schema/migrations, secrets/certs, or health data (mirrors todos/TEMPLATE.md). The
# "low/medium" label is self-assigned; this script is the backstop that catches a
# MISLABELED sensitive change before it lands on main unreviewed.
#
# This is a DENYLIST of sensitive surfaces (the deliberate inverse of this script's
# original fail-CLOSED allowlist). The trade-off was chosen explicitly: a self-assigned
# "free pass" for the common case, with a HOLD only on the sensitive boundary. The
# cost is fail-OPEN on a NEW sensitive surface nobody has added here yet — so when you
# introduce a new auth/billing/schema/secrets/health surface, ADD ITS PATTERN BELOW.
# When in doubt, widen the regex: a false HOLD only costs a manual merge; a missing
# pattern auto-merges a sensitive change.
#
# Usage:  scripts/todo-automerge-guard.sh <pr-number>
# Exit 0 = OK to auto-merge   |   Exit 1 = HOLD for human review (also on any error)
set -euo pipefail

PR="${1:?usage: todo-automerge-guard.sh <pr-number>}"

# Sensitive "do-not-delegate" surfaces. A changed CODE/CONFIG file matching ANY of
# these forces a HOLD even on green CI. Patterns are path-anchored to avoid false hits
# (e.g. an `apple.png` asset, the grocery-receipt OCR feature, or `shared/schemas/`
# Zod files must NOT match — only IAP `receipt-validation` and the DB `shared/schema.ts`
# do). Validated against the repo file list when authored.
SENSITIVE_REGEX='^server/middleware/|^server/routes/auth\.|(^|/)AuthContext|^client/hooks/useAuth\.|(^|/)token-storage|verification-token|(^|/)jwt[.-]|jwt-types|bcrypt|(^|/)password|^client/lib/iap/|^server/routes/subscription|^client/lib/subscription/|subscription-tier|receipt-validation|apple-iap|google-iap|app-store-server|entitlement|^shared/schema\.ts$|^migrations/|drizzle\.config|\.env|^server/certs/|\.pem$|\.cer$|(^|/)[Hh]ealth'

# Markdown, docs/, and todos/ are never sensitive CODE — exclude them so a todo whose
# slug happens to contain a sensitive word (e.g. todos/archive/healthkit-….md, which
# rides every todo PR) cannot trip a HOLD. A docs-only PR therefore auto-merges.
NEVER_SENSITIVE_REGEX='^(docs|todos)/|\.md$'

files="$(gh pr diff "$PR" --name-only)" || {
  echo "guard: HOLD PR #$PR — could not read changed files (gh error). Fail-closed."
  exit 1
}
if [ -z "$files" ]; then
  echo "guard: HOLD PR #$PR — no file changes (nothing to merge)"
  exit 1
fi

code_files="$(printf '%s\n' "$files" | grep -vE "$NEVER_SENSITIVE_REGEX" || true)"
sensitive="$(printf '%s\n' "$code_files" | grep -E "$SENSITIVE_REGEX" || true)"
if [ -n "$sensitive" ]; then
  echo "guard: HOLD PR #$PR — touches the sensitive do-not-delegate boundary:"
  printf '  %s\n' "$sensitive"
  echo "Review these by hand; do not auto-merge."
  exit 1
fi

echo "guard: OK PR #$PR — no changed file is on the sensitive boundary"
exit 0
