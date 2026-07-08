#!/usr/bin/env bash
# todo-automerge-guard.sh — FAIL-CLOSED batch-merge eligibility check for /todo PRs.
#
# MODEL (2026-07-06 restored — see docs/todo-automation-runbook.md): a guard-OK PR gets
# GitHub's native `gh pr merge --auto` armed by the /todo executor immediately, so it
# lands on its own once CI is green. This script only CLASSIFIES eligibility — it never
# merges anything itself. A /todo PR is eligible ONLY if BOTH gates pass:
#   1. TODO GATE — the archived todo riding the PR (todos/archive/<slug>.md) has
#      priority low|medium, no `security` mention, and no sensitive-intent keyword
#      (auth/session/admin/etc. — see SENSITIVE_INTENT_KEYWORDS) in its frontmatter.
#      This lives here, not only in the executor, because a fresh morning session
#      re-running this guard has no overnight MERGE_ELIGIBLE report — the guard is the
#      one artifact every merge path re-runs, so it must enforce the whole policy itself.
#   2. PATH GATE — EVERY changed file is on the known-safe ALLOWLIST and none hits the
#      sensitive override.
# Anything else HOLDs for individual human review — an unanticipated path, the whole
# server/routes/ directory (the request/authz boundary — see SAFE_ALLOWLIST's comment for
# why this one root HOLDs wholesale instead of being enumerate-the-sensitive-ones), the
# whole server/middleware/ directory, .github/ (the CI gates), scripts/ (incl. this
# guard), migrations, shared/schema.ts, secrets/certs, plus explicit sensitive files named
# in SENSITIVE_OVERRIDE that live inside the otherwise-open client/ and server/storage/
# roots.
#
# To widen the pass: ADD a known-safe prefix to SAFE_ALLOWLIST. If you allowlist a dir
# that also holds a sensitive file (e.g. server/services holds the IAP services), add
# that file to SENSITIVE_OVERRIDE so it still HOLDs. A missed allowlist entry only costs
# a manual merge; never the other way around. Before allowlisting a WHOLE new root,
# specifically check whether security-relevant logic (rate limiting, input validation,
# auth checks) hides in generically-named or shared-infra files there — enumerating the
# sensitive files after the fact failed for server/routes/ (see git log).
#
# Usage:  scripts/todo-automerge-guard.sh <pr-number>
# Exit 0 = eligible for the user's batch-merge (MERGE_ELIGIBLE: yes) — NOT a merge command
# Exit 1 = HOLD: needs individual review — a changed file is sensitive / not on the
#          allowlist, or the TODO gate failed (no archived todo in the diff, an archive
#          file absent from the PR head, priority not low/medium, 'security' in its
#          frontmatter, or a sensitive-intent keyword in its frontmatter)
# Exit 2 = ERROR: could not evaluate (gh failure / empty diff) — fail-closed, treat as HOLD
# The caller distinguishes a real HOLD (1) from a tooling error (2): a HOLD means the PR
# needs individual review; an error means eligibility couldn't be decided (e.g. gh unauth).
# Nothing in this script merges anything; the user batch-merges eligible PRs themselves.
set -euo pipefail

PR="${1:?usage: todo-automerge-guard.sh <pr-number>}"

# Known-safe surfaces. A file is batch-merge-eligible only if it matches one of these:
# all of client/ (UI, hooks, context, lib, screens, navigation, constants, ...) and all of
# server/storage/ (minus the sensitive files named in SENSITIVE_OVERRIDE below),
# business-logic services, shared pure modules (types / zod-schemas / constants / lib),
# any test, an extracted *-utils file, and docs/todos/ markdown. NOTE: server/routes/,
# server/middleware/, migrations/, shared/schema.ts, .github/, scripts/, certs, .env are
# deliberately ABSENT — they HOLD in full, not file-by-file. server/routes/ HOLDs
# wholesale (2026-07-08, reverted from a brief whole-root widening) because it's the
# request/authz boundary: an initial widening attempt found real auth-security logic
# (rate limiters, password-strength schemas, upload validation, external API-key auth)
# living in shared route infra whose filenames name no sensitive keyword — see git log
# for the full incident — so enumerate-the-sensitive-ones-in-SENSITIVE_OVERRIDE was the
# wrong default for this specific root. client/ and server/storage/ stay open under the
# SAME model (a widened root is filename-denylist-protected, not proven exhaustive) —
# accepted there, unlike routes, because (a) the two comparable shared chokepoints found
# in client/ (query-client.ts, reporter.ts — see SENSITIVE_OVERRIDE below) already carry
# adversarial tests pinning the security property itself, which routes' rate-limiter/
# password-schema values did NOT have, so an obvious regression fails CI before it can
# auto-merge, and (b) reverting either root wholesale would give up most of this widening's
# value. This is a residual-risk acceptance, not a proof that no other such file exists —
# see the script's git history / PR description for the human's sign-off on this tradeoff.
SAFE_ALLOWLIST='^client/|^server/storage/|^server/services/|^shared/types/|^shared/schemas/|^shared/constants/|^shared/lib/|(^|/)__tests__/|\.test\.[jt]sx?$|\.spec\.[jt]sx?$|(-|\.)utils\.tsx?$|^docs/|^todos/|\.md$'

# Sensitive files that DO live inside an allowlisted dir and must HOLD anyway: the IAP /
# billing surfaces (receipt-validation, store-notification, store-webhook, subscription-*,
# entitlement, Premium*), the health-PII onboarding screens (client/**Health*), and the
# auth/session surfaces now exposed by opening client/ and server/storage/ as whole roots
# — server/middleware/ (whole dir, defense-in-depth for todo-executor.md's separate
# skip-gate, which sources this constant), token-storage, AuthContext, useAuth,
# VerifyEmailScreen (the one genuinely auth-adjacent verification surface — confirmed by
# reading it: it calls verifyEmailRequest / resendVerificationRequest),
# server/storage/users.ts (content-sensitive role/mass-assignment surface, not
# name-sensitive), sessions.ts (auth session storage — anchored so it does NOT match the
# unrelated CookSession/QuickLogSession feature), SessionExpiryBridge, admin*, and Login*.
# (admin/Login* currently only match files under server/routes/, which HOLDs wholesale
# regardless — kept as forward-looking coverage for a future client/ or server/storage/
# file of the same name, same as secret/credential below.) server/storage/verification.ts
# and client/components/VerificationBadge are the UNRELATED Verified Product API
# (barcode/nutrition-data verification — see shared/types/verification.ts) and must NOT be
# held; server/routes/verification.ts holds too, but only because ALL of server/routes/
# does now — not because it's flagged sensitive. Grocery "receipt" OCR (receipt.ts,
# Receipt*Screen) and push-notification tokens (push-tokens.ts, push-token-registration)
# are NOT sensitive and must pass too. client/lib/query-client.ts (attaches the Bearer
# token to every API call and detects session death — found by a final-review hunt for
# the same shared-infra pattern that bit server/routes/) and client/lib/reporter.ts
# (scrubEvent strips Authorization headers before Sentry — "belt-and-suspenders" defense
# against a live JWT leaking to a third-party SaaS) must HOLD despite already having
# adversarial test coverage (a subtle logic change, not just deletion, could still slip
# through both gates).
SENSITIVE_OVERRIDE='receipt-validation|store-notification|store-webhook|(^|/)subscription|(^|/)iap[./-]|apple-?iap|google-?(iap|play)|app-store-server|in-app-purchase|entitlement|(^|/)[Hh]ealth|(^|/)server/middleware/|token-storage|AuthContext|useAuth|VerifyEmailScreen|(^|/)server/storage/users\.ts$|(^|/)sessions\.ts$|SessionExpiryBridge|admin|Premium|[Ll]ogin|api-key|secret|credential|(^|/)query-client\.ts$|(^|/)reporter\.ts$'

# Sensitive-domain keywords for the TODO gate's intent check (below): HOLDs any todo
# whose own title/frontmatter names a sensitive domain, regardless of which file it ends
# up touching — the backstop for a future sensitive file whose name gives no signal (see
# server/storage/users.ts in SENSITIVE_OVERRIDE above for why this matters). Sourced at
# runtime by todo-executor.md's research-delegation skip-gate too — one definition.
# session, verif, receipt, secret, and health are deliberately EXCLUDED from this list
# (though session/verif/receipt/secret remain in SENSITIVE_OVERRIDE for path matching, and
# health-NAMED files still match `(^|/)[Hh]ealth` there too): as free-text title words they
# collide with this app's own recipe/nutrition vocabulary — "secret ingredient", "grocery
# receipt OCR", "cook session", "barcode verification" (Verified Product API), and "health
# score on recipe card" / "healthy-recipe filter" are all ordinary, non-sensitive todos that
# would otherwise be wrongly HELD. (Residual gap: health-PII living in an innocuously named
# file — e.g. profile-hub.ts, dietary-context.ts — isn't path-covered by name and now relies
# on CI + review rather than this gate, same as any other unnamed-sensitive-file gap.)
SENSITIVE_INTENT_KEYWORDS='auth|jwt|login|password|admin|premium|subscription|iap|api-key|credential'

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
  # Capture stderr too: a 404 (file listed in the diff but absent from the PR head) is a
  # policy HOLD — the archive can't be verified, so the PR can't be eligible. Any other
  # failure stays exit 2 (tooling error), with the gh error echoed instead of discarded.
  # On SUCCESS, stray stderr noise (e.g. a gh update banner) can land in $raw — harmless:
  # the frontmatter awk below only reads lines between the first pair of --- markers.
  if ! raw="$(gh api -H "Accept: application/vnd.github.raw" "repos/{owner}/{repo}/contents/${tf}?ref=refs/pull/${PR}/head" 2>&1)"; then
    if grep -qE '\bHTTP 404\b|"status": *"404"' <<< "$raw"; then
      echo "guard: HOLD PR #$PR — ${tf} is listed in the diff but absent from the PR head (deleted?); cannot verify frontmatter"
      echo "Needs individual review; exclude from the batch-merge."
      exit 1
    fi
    echo "guard: ERROR PR #$PR — could not read ${tf} from the PR head (gh error). Fail-closed."
    printf '%s\n' "$raw"
    exit 2
  fi
  # Frontmatter = lines between the first pair of --- markers. Here-strings, not
  # `printf | …` pipes: under pipefail a producer-pipe into an early-exiting consumer
  # can fail open via SIGPIPE (see docs/solutions: pipefail-echo-grep-condition).
  fm="$(awk '/^---[[:space:]]*$/{n++; next} n==1' <<< "$raw")"
  # Single awk (prints the first match, then exits itself) — the previous `sed | head -n1`
  # form is a consumer-kills-producer pipe that can die 141 under pipefail when head
  # closes the pipe early. Same SIGPIPE family as the here-string note above.
  prio="$(awk '/^priority:/{sub(/^priority:[[:space:]]*/,""); print; exit}' <<< "$fm" | tr -d "[:space:]\"'" | tr '[:upper:]' '[:lower:]')"
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
  if grep -qiE "$SENSITIVE_INTENT_KEYWORDS" <<< "$fm"; then
    echo "guard: HOLD PR #$PR — ${tf} frontmatter/title mentions a sensitive-domain keyword (auth/session/admin/etc.); always individual review"
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
