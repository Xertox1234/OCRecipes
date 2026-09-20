#!/usr/bin/env bash
# todo-automerge-guard.sh — FAIL-CLOSED batch-merge eligibility check for /todo PRs.
#
# MODEL (2026-07-06 restored — see docs/todo-automation-runbook.md): a guard-OK PR gets
# GitHub's native `gh pr merge --auto` armed by the /todo executor immediately, so it
# lands on its own once CI is green. This script only CLASSIFIES eligibility — it never
# merges anything itself. By default, a /todo PR is eligible ONLY if BOTH gates pass:
#   1. TODO GATE — the archived todo riding the PR (todos/archive/<slug>.md) has
#      priority low, no `security` mention, and no sensitive-intent keyword
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
# guard), migrations, shared/schema.ts, secrets/certs, docs/rules/, docs/legacy-patterns/,
# .claude/agents/, .claude/skills/, docs/AI_WORKFLOW.md and docs/PATTERNS.md (the binding
# review rules, the frozen pattern-documentation archive every roster reviewer's checklist
# cites as its reference body, and the files that define what "reviewed" means — structural
# entries carved OUT of the markdown pass-through; see STRUCTURAL_SENSITIVE,
# SENSITIVE_OVERRIDE, and PATH GATE step 2),
# plus explicit sensitive files named
# in SENSITIVE_OVERRIDE that live inside the otherwise-open client/ and server/storage/
# roots. server/routes/, .github/, scripts/, and migrations/ are held BOTH by SAFE_ALLOWLIST
# omission AND by an explicit whole-dir SENSITIVE_OVERRIDE entry — belt-and-suspenders,
# because SAFE_ALLOWLIST's directory-independent test/spec/utils/md tokens (below) would
# otherwise let a file under one of these directories slip through on filename pattern
# alone, regardless of directory (this bit a real file: server/routes/__tests__/
# auth-route-wiring.test.ts, itself a security-relevant guard, silently passed until this
# was added).
#
# To widen the pass: ADD a known-safe prefix to SAFE_ALLOWLIST. If you allowlist a dir
# that also holds a sensitive file (e.g. server/services holds the IAP services), add
# that file to SENSITIVE_OVERRIDE so it still HOLDs. A missed allowlist entry only costs
# a manual merge; never the other way around. Before allowlisting a WHOLE new root,
# specifically check whether security-relevant logic (rate limiting, input validation,
# auth checks) hides in generically-named or shared-infra files there — enumerating the
# sensitive files after the fact failed for server/routes/ (see git log), and hand-hunting
# client/ and server/services/ for the same pattern found 15+ more instances in one pass.
# For client/ and server/services/ specifically, don't rely on hand-hunting alone — see
# the "drift detection" test in scripts/__tests__/todo-automerge-guard.test.ts, which
# re-runs the hunt for the two most-recurring signatures (Bearer-token attachment,
# health-PII field declarations) as a CI-enforced check, so the next instance fails a test
# instead of silently auto-merging.
#
# Usage:  scripts/todo-automerge-guard.sh [--paths-only] <pr-number>
# Exit 0 (default invocation) = eligible (MERGE_ELIGIBLE: yes) — NOT a merge command; the
#          executor arms native GitHub auto-merge (gh pr merge --auto) for eligible PRs
#          after PR creation. Exit 0 (--paths-only) = every changed file is allowlist-safe;
#          says nothing about todo eligibility
# Exit 1 = HOLD: needs individual review — a changed file is sensitive / not on the
#          allowlist, or the TODO gate failed (no archived todo in the diff, an archive
#          file absent from the PR head, priority not low, 'security' in its
#          frontmatter, or a sensitive-intent keyword in its frontmatter)
# Exit 2 = ERROR: could not evaluate (gh failure / empty diff) — fail-closed, treat as HOLD
# The caller distinguishes a real HOLD (1) from a tooling error (2): a HOLD means the PR
# needs individual review; an error means eligibility couldn't be decided (e.g. gh unauth).
# Nothing in this script merges anything; the executor arms auto-merge for eligible PRs
# (todo-executor.md Step 10) and held PRs wait for individual human review.
set -euo pipefail

# --paths-only runs the PATH GATE alone. The TODO GATE answers "is this a low-priority
# todo eligible for unattended batch-merge?" — a different question from "is this content
# risky?", and it HOLDs any PR with no todos/archive file (line ~199), which would make
# the merge gate demand evidence for nearly every ordinary code PR.
PATHS_ONLY=""
if [ "${1:-}" = "--paths-only" ]; then PATHS_ONLY=1; shift; fi
PR="${1:?usage: todo-automerge-guard.sh [--paths-only] <pr-number>}"

# Known-safe surfaces. A file is batch-merge-eligible only if it matches one of these:
# all of client/ (UI, hooks, context, lib, screens, navigation, constants, ...) and all of
# server/storage/ (minus the sensitive files named in SENSITIVE_OVERRIDE below),
# business-logic services, shared pure modules (types / zod-schemas / constants / lib),
# any test, an extracted *-utils file, and docs/todos/ markdown — except docs/rules/ and
# docs/legacy-patterns/, which stay matched by ^docs/ here but HOLD on SENSITIVE_OVERRIDE
# below (binding review rules / the frozen pattern-reference archive, not ordinary docs).
# NOTE: server/routes/,
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
# — server/middleware/, server/routes/, .github/, scripts/, migrations/ (whole dirs — the
# last four ALSO close a bypass where the allowlist's directory-independent test/spec/utils
# tokens below let a file under an otherwise-unlisted directory slip through, e.g.
# server/routes/__tests__/auth-route-wiring.test.ts, itself a security-relevant static-scan
# guard; server/middleware/ is defense-in-depth for todo-executor.md's separate skip-gate,
# which sources this constant), token-storage, AuthContext, useAuth, verification-token
# (server/lib/verification-token.ts — JWT-signs/verifies email-verification tokens; not
# covered by the server/routes/ whole-dir entry since it lives in server/lib/),
# VerifyEmailScreen (the one genuinely auth-adjacent verification surface — confirmed by
# reading it: it calls verifyEmailRequest / resendVerificationRequest),
# server/storage/users.ts (content-sensitive role/mass-assignment surface, not
# name-sensitive), sessions.ts / session-store.ts / user-sessions.ts (HELD out of caution
# for the auth-session-storage naming pattern, despite server/storage/sessions.ts itself
# actually being a generic upload/confirm session store per its own header comment — not
# auth-related; an earlier version of this comment wrongly asserted it WAS auth-session
# storage, confirmed by reading the file — kept HELD anyway since a false-positive HOLD
# costs only a manual review, and this is the anchor's original intent even if this
# specific file doesn't need it; the literal sessions.ts anchor doesn't cover the latter
# two variants, though no such file exists today; anchored so none of these match the
# unrelated CookSession/QuickLogSession feature — see the multi-hook block below for why
# that feature's OWN files are covered by name instead), SessionExpiryBridge, [Aa]dmin, and
# [Pp]remium (case-classed to cover both server's lowercase-kebab and client's PascalCase
# naming conventions — a bare `admin`/`Premium` literal missed half of each pair).
# docs/rules/ and docs/legacy-patterns/ are the two whole-directory entries that are NOT
# code: docs/rules/ files are this repo's BINDING review rules (security.md carries the
# IDOR / JWT / rate-limiting / SSRF rules every reviewer and every injected-pattern hook
# acts on; accessibility.md, database.md and the rest are equally binding, which is why
# this is scoped to the whole directory and not to security.md alone — a per-file list
# would silently go stale the next time a rules file is added). It needs
# BOTH this entry and the PATH GATE's STRUCTURAL_SENSITIVE check (step 2, below): SAFE_ALLOWLIST's
# ^docs/ prefix already passes them, and the markdown exemption used to `continue` before any
# sensitivity check was ever consulted, so a batch-generated PR trimming a binding security rule was
# auto-merge eligible and could land overnight unreviewed — contradicting this repo's own rule
# that security changes get individual review. This is a real path, not a hypothetical:
# todo-executor.md Step 5b appends CRITICAL/HIGH rule bullets to docs/rules/{domain}.md from
# inside the /todo PR itself. docs/legacy-patterns/ is covered for the same class of reason —
# see STRUCTURAL_SENSITIVE's own comment below for its decision record and corpus measurement.
# Every OTHER docs path (docs/solutions/, docs/research/, runbooks) and all of todos/ keeps
# the exemption. Listing both here rather than only in STRUCTURAL_SENSITIVE
# is what makes todo-executor.md's research-delegation skip-gate inherit them — that gate reads
# SENSITIVE_OVERRIDE and never looks at SAFE_ALLOWLIST.
# server/storage/verification.ts and client/components/VerificationBadge are the UNRELATED
# Verified Product API (barcode/nutrition-data verification — see
# shared/types/verification.ts) and must NOT be held. Grocery "receipt" OCR (receipt.ts,
# Receipt*Screen) and push-notification tokens (push-tokens.ts, push-token-registration)
# are NOT sensitive and must pass too.
#
# client/lib/query-client.ts (attaches the Bearer token to every API call and detects
# session death) and client/lib/reporter.ts (scrubEvent strips Authorization headers
# before Sentry) were the first shared-infra chokepoints found this way; a later,
# deliberately-repeated hunt for the SAME pattern (grep client/ and server/services/ for
# tokenStorage + Bearer-header construction) found ten more: client/hooks/useAvatarUpload,
# useCarouselRecipes, useChat, useCookSession, useHistoryData, useMenuScan,
# useNutritionLookup, useReceiptScan, useSavedItems, and useCoachStream — one of which
# (useCookSession) an earlier version of this PR's own test suite had asserted was
# "confirmed non-sensitive." See scripts/__tests__/todo-automerge-guard.test.ts's
# "drift detection" block below for the mechanism that now re-runs this hunt as a test,
# so the ELEVENTH such file fails loudly instead of silently auto-merging.
#
# client/context/OnboardingContext.tsx, client/hooks/useDietaryProfileForm.ts, and
# client/hooks/useAllergenCheck.ts hold real health-PII (allergies, healthConditions)
# under names the (^|/)[Hh]ealth token doesn't catch — found by the same hunt, also now
# covered by the drift-detection test's second signature (allergies/healthConditions field
# declarations). server/storage/export.ts (CCPA/PIPEDA data-export PII-redaction
# allowlist), server/services/email.ts (per-recipient anti-abuse/anti-enumeration rate
# limiter gating verification-email sends), and client/lib/durable-owner.ts (the trust
# anchor offline-queue-drain.ts itself depends on for cross-user data isolation) and
# client/lib/offline-queue-drain.ts / client/lib/photo-upload.ts (bearer-token
# attachment + a documented cross-user-replay/TOCTOU guard, subject of 3 dedicated past
# security-fix PRs) are each one-off instances of hidden security logic in a
# generically-named, allowlisted-directory file — named individually since none shares a
# signature generic enough for the drift-detection test to generalize without becoming a
# broad "security detector" (deliberately avoided — see that test's own comment).
SENSITIVE_OVERRIDE='receipt-validation|store-notification|store-webhook|(^|/)subscription|(^|/)iap[./-]|apple-?iap|google-?(iap|play)|app-store-server|in-app-purchase|entitlement|(^|/)[Hh]ealth|(^|/)server/middleware/|(^|/)server/routes/|(^|/)\.github/|(^|/)scripts/|(^|/)migrations/|(^|/)docs/rules/|(^|/)docs/legacy-patterns/|(^|/)\.claude/(agents|skills)/|(^|/)docs/AI_WORKFLOW(\.md$|/)|(^|/)docs/PATTERNS(\.md$|/)|token-storage|AuthContext|useAuth|verification-token|VerifyEmailScreen|(^|/)server/storage/users\.ts$|(^|/)sessions\.ts$|(^|/)session-store\.ts$|(^|/)user-sessions?\.ts$|SessionExpiryBridge|[Aa]dmin|[Pp]remium|[Ll]ogin|api-key|secret|credential|(^|/)query-client\.ts$|(^|/)reporter\.ts$|(^|/)offline-queue-drain\.ts$|(^|/)photo-upload\.ts$|(^|/)cookbook-cover-upload\.ts$|OnboardingContext|useDietaryProfileForm|useAllergenCheck|dietary-context|(^|/)export\.ts$|(^|/)server/services/email\.ts$|durable-owner|useAvatarUpload|useCarouselRecipes|useChat|useCookSession|useHistoryData|useMenuScan|useNutritionLookup|useReceiptScan|useSavedItems|useCoachStream'

# Structural subset of the above: whole-directory and exact-path entries ONLY, no
# free-text keywords. Read by the PATH GATE's structural-sensitivity check (below)
# BEFORE the markdown/docs/todos exemption, so a markdown file under any of these can
# never take that exemption — this is what closes the gap where every whole-directory
# SENSITIVE_OVERRIDE entry had a silent `\.md$` bypass through the exemption that used
# to run first. Deliberately narrower than SENSITIVE_OVERRIDE: that regex also carries
# free-text keywords ([Aa]dmin, [Pp]remium, [Ll]ogin, secret, credential, (^|/)[Hh]ealth,
# …) meant to classify CODE by filename, and running those over prose HOLDs any ordinary
# doc/todo whose slug or title happens to contain an everyday word — measured over the
# full tracked corpus (git ls-files, no sampling): 0 unintended changes under
# docs/solutions/ or todos/ with this narrower regex, vs 33 with the full
# SENSITIVE_OVERRIDE. .claude/agents/ and .claude/skills/ are added because they are the
# files that DEFINE what "reviewed" means — every roster reviewer's checklist lives
# there — and docs/AI_WORKFLOW.md / docs/PATTERNS.md are the Review Policy roster and the
# knowledge-base index those checklists point back to. All four are ALSO added to
# SENSITIVE_OVERRIDE above for defense-in-depth, same belt-and-suspenders reasoning as
# the other whole-dir entries there.
# BOUNDARY, decided deliberately rather than left open: this set is `.claude/agents/` +
# `.claude/skills/` and NOT `.claude/` wholesale. `.claude/hooks/**` is excluded because it
# holds no markdown at all (`git ls-files '.claude/hooks/*.md'` is empty) and every tracked file
# under it is `.sh`, which the step-1 allowlist already holds — so adding it would be a rule with
# no live row behind it. The one tracked `.claude` markdown outside agents/skills is an
# auto-memory file, which is not review-governing content. Matching is case-INSENSITIVE below,
# so `.claude/Agents/` and a `docs/ai_workflow.md` spelling cannot walk around this on a
# case-preserving filesystem, and the two exact-path entries admit a trailing `/` so a later
# split of AI_WORKFLOW.md or PATTERNS.md into a directory stays covered.
# If `.claude/hooks/**` ever gains markdown, widen to `(^|/)\.claude/` wholesale: over-HOLD is
# the cheap direction here, per this script's own header.
#
# docs/legacy-patterns/ (16 tracked files, 2026-09-20, `git ls-files docs/legacy-patterns`)
# — DECIDED: COVERED, added to both this constant and SENSITIVE_OVERRIDE above. It is the
# frozen pattern-documentation archive that the newly-protected reviewer checklists cite as
# their reference body: `.claude/agents/code-reviewer.md` links into it 7 times and
# `mobile-reviewer.md` 11 times (both counts include inline citations and each file's
# closing reference list), and `security-auditor.md` names
# `docs/legacy-patterns/security.md` as "Full security pattern documentation" in its own
# reference list. That is the same "files that DEFINE what reviewed means" argument that put
# `.claude/agents/` and `.claude/skills/` here — this directory is what those checklists
# point AT. There is no current WRITE path to it today: `code-reviewer.md` explicitly calls
# it a "frozen archive, retired as write target", and `grep -rn legacy-patterns
# .claude/hooks/` finds it only in a corpus/fixture file and one code comment, never as an
# injection target — so the exposure is latent, not active. Covering it now means it stays
# HELD automatically the moment that changes, instead of needing a second pass to notice.
# Measured over the full tracked corpus (`git ls-files`, re-derived, not assumed): all 16
# docs/legacy-patterns/*.md paths flip PASS→HOLD; a same-run control batch
# (docs/solutions/+todos/, the exemption's own high-volume case) stays 0 HOLD→PASS — see
# scripts/__tests__/todo-automerge-guard.test.ts's generated-corpus and
# docs/legacy-patterns/ blocks. Over-HOLD is the cheap direction here, per this script's own
# header.
STRUCTURAL_SENSITIVE='(^|/)server/middleware/|(^|/)server/routes/|(^|/)\.github/|(^|/)scripts/|(^|/)migrations/|(^|/)docs/rules/|(^|/)docs/legacy-patterns/|(^|/)\.claude/(agents|skills)/|(^|/)docs/AI_WORKFLOW(\.md$|/)|(^|/)docs/PATTERNS(\.md$|/)'

# Sensitive-domain keywords for the TODO gate's intent check (below): HOLDs any todo
# whose own title/frontmatter names a sensitive domain, regardless of which file it ends
# up touching — the backstop for a future sensitive file whose name gives no signal (see
# server/storage/users.ts in SENSITIVE_OVERRIDE above for why this matters). Sourced at
# runtime by todo-executor.md's research-delegation skip-gate too — one definition.
# session, verif, receipt, secret, and health are deliberately EXCLUDED from this list:
# as free-text title words they collide with this app's own recipe/nutrition vocabulary —
# "secret ingredient", "grocery receipt OCR", "cook session", "barcode verification"
# (Verified Product API), and "health score on recipe card" / "healthy-recipe filter" are
# all ordinary, non-sensitive todos that would otherwise be wrongly HELD. This does NOT
# mean SENSITIVE_OVERRIDE (above) carries bare `verif`/`receipt`/`session` tokens — it
# doesn't; only the specific compounds VerifyEmailScreen, receipt-validation, sessions.ts/
# session-store.ts/user-sessions.ts, and the named CookSession-adjacent hooks are covered
# by path. `secret` and `health` ARE bare tokens there (`(^|/)[Hh]ealth` for health-NAMED
# files). A todo about a genuinely sensitive file whose name gives no signal — the
# server/storage/users.ts case this whole gate exists to backstop, or any future file like
# it — relies on CI + review, not this list, same as any other unnamed-sensitive-file gap.
SENSITIVE_INTENT_KEYWORDS='auth|jwt|login|password|admin|premium|subscription|iap|api-key|credential'

# A git-detected RENAME is reported by `gh pr diff --name-only` as its DESTINATION path ONLY,
# so a high-similarity move OUT of a covered directory reads as a plain new file and evades
# every path check below — including the STRUCTURAL_SENSITIVE check this gate relies on.
# Measured pair: PR #977 carries `R067 todos/… -> todos/archive/…` and `gh pr diff 977
# --name-only` lists only the destination, while control PR #965 (which git scored as
# delete+add rather than a rename) lists BOTH paths. So removals ARE normally listed and the
# blind spot is specific to renames, not to deletions generally. Concretely, a PR moving
# `.claude/agents/code-reviewer.md` to `docs/solutions/kb/code-reviewer.md` would read as one
# ordinary markdown file, take the SAFE_ALLOWLIST exemption, and arm auto-merge while walking a
# reviewer checklist out of a protected directory.
#
# `pulls/{n}/files` carries `previous_filename` on a rename, so emitting it alongside
# `filename` gates the SOURCE path too.
#
# `--paginate` closes the PER-PAGE truncation only (this endpoint pages at 30). It does NOT lift
# the endpoint's server-side maximum file count, so pagination alone is not a completeness
# guarantee and the comment must not claim one. Under-reporting is the dangerous direction here
# because of the CONSUMER, not because of this gate: merge-review-guard.sh treats this script's
# exit 0 as "no review record required", so a short list is a MERGE-GATE bypass rather than
# merely a missed auto-merge HOLD. The count check below is the actual completeness detector.
# Error handling is unchanged: gh failure exits 2, empty output exits 2.
# Rows are CLASSED on the way out: `N ` the page's own element count (see the STRUCTURAL ROW
# COUNT check below), `F ` a destination (one per changed FILE), `P ` a rename SOURCE, `X` a
# rename whose source is missing, `B` a filename (or rename source) that itself contains a
# literal newline. The class is what lets the completeness check below count FILES rather
# than LINES -- see the note there for why that distinction is the whole point. `// ""` on
# previous_filename because jq truthiness treats "" as TRUE, so a present-but-empty value
# would otherwise emit a blank path and skip the X arm.
#
# B is not a new gate bolted onto this emission -- it IS "the existing jq emission", reading
# `.filename`/`.previous_filename` for a literal newline while each is still a structured JSON
# string, before any text-flattening happens. That ordering is what makes "the completeness
# count no longer derives from flattened text" literally true: a newline-bearing name never
# reaches "F "/"P " raw-printed text at all, so it can never forge a SECOND physical line that
# looks like a class-matching row once jq's raw output is concatenated. Measured: the item
# `{filename: "client/a.ts\nF client/b.ts"}` used to raw-print as TWO lines -- "F client/a.ts"
# and "F client/b.ts" -- the second indistinguishable from a real destination row, since it
# also matches `^F `. Under this filter the SAME item raw-prints as ONE line, "B"; neither the
# real filename nor the forged one ever reaches output. `if/then/else`, not `select` plus the
# unconditional branch: `select` alone would still fall through to the F/P/X branch on a
# NON-match, but on a MATCH the F/P/X branch must be suppressed entirely for that item, not
# merely joined by a warning row.
raw_files="$(gh api "repos/{owner}/{repo}/pulls/$PR/files" --paginate \
  --jq '("N " + (length|tostring)),
        (.[] | if ((.filename // "") | test("\n")) or ((.previous_filename // "") | test("\n"))
               then "B"
               else ("F " + .filename),
                    (select((.previous_filename // "") != "") | "P " + .previous_filename),
                    (select(.status == "renamed" and ((.previous_filename // "") == "")) | "X")
               end)')" || {
  echo "guard: ERROR PR #$PR — could not read changed files (gh error). Fail-closed."
  exit 2
}
# Every row must carry a class BEFORE anything is stripped. `sed -n 's/^[FP] //p'` DROPS what it
# cannot match, and the completeness check cannot notice: an unclassed row contributes no `F `
# line, so seen and declared stay equal and the path it carried is gated by nothing. `X$`, `B$`,
# and `N [0-9]+$` all stay in the allowed set, or those sentinel rows themselves read as unclassed
# and their specific diagnostics below become unreachable.
# `-n` first: a here-string of an EMPTY value still yields one empty line, which is not a valid
# class, so an empty read would trip this arm and mask the clearer "no file changes" error below.
# rc captured explicitly rather than tested inline: a broken regex exits 2, and a bare `if` reads
# ANY nonzero as "every row classed" and skips this refusal entirely. Only rc 1 means "all rows
# matched". Mirrors the rc_struct/rc_sens idiom the PATH GATE already uses for the same reason —
# the fail-closed direction should be structural, not incidental.
rc_class=0
grep -qvE '^([FP] |X$|B$|N [0-9]+$)' <<< "$raw_files" || rc_class=$?
if [ -n "$raw_files" ] && [ "$rc_class" -ne 1 ]; then
  echo "guard: ERROR PR #$PR — a changed-file row came back without a recognisable class, so the file list cannot be gated reliably. Fail-closed."
  exit 2
fi

# A changed file's name (or its rename source) that itself contains a literal newline is
# refused outright, not merely dropped: see the B sentinel's comment above the jq filter for
# why emitting "F "/"P " for it at all would let it forge a row the completeness check below
# cannot tell from a real one. `X$` already does this for a missing rename source; `B$` is the
# same fail-closed idiom applied to the cause this todo closes. Checked BEFORE the `files`
# extraction/empty-check below: if every changed file in a PR happens to be newline-bearing,
# stripping B rows first would leave `files` empty and surface the generic, less actionable
# "no file changes" message instead of naming the real, more specific cause.
if grep -qx 'B' <<< "$raw_files"; then
  echo "guard: ERROR PR #$PR — a changed file's name (or its rename source) contains a literal newline, which could forge extra rows once the response is flattened to text. Fail-closed."
  exit 2
fi

files="$(sed -n 's/^[FP] //p' <<< "$raw_files")"
if [ -z "$files" ]; then
  echo "guard: ERROR PR #$PR — no file changes (nothing to evaluate)"
  exit 2
fi

# A row the API calls a rename but gives no previous_filename would have its SOURCE path
# silently dropped -- the exact blind spot reading this endpoint was meant to close. Refuse
# rather than gate a list known to be missing a path.
# HERE-STRING, not a producer pipe. `grep -q` exits on first match, so under `set -o pipefail`
# a `printf ... | grep -q` pipeline returns 141 (SIGPIPE on the writer) once the input exceeds
# the 64KB pipe buffer -- which makes this `if` FALSE and skips this fail-closed sentinel on
# exactly the large PRs where an odd file list is most likely. Measured: 79623 bytes with the X
# row second gave exit 0 through the pipe form and exit 2 through this one, while a 63-byte
# input carrying the SAME row exited 2 under both -- so the flip is the regime, not the row.
# (Those two figures are the CURRENT payload's, re-derived after it was resized: the earlier
# 92016/85 pair described a 4000-row payload that was replaced because it timed out in CI.
# The conclusion re-measures true at the new sizes; only the arithmetic was superseded.)
# Same family this file already remedies further down with here-strings.
if grep -qx 'X' <<< "$raw_files"; then
  echo "guard: ERROR PR #$PR — a changed file is reported as renamed with no previous_filename, so its SOURCE path cannot be gated. Fail-closed."
  exit 2
fi

# STRUCTURAL ROW COUNT. `--paginate` re-runs the SAME --jq filter once PER PAGE (`gh help api`:
# "Each page is a separate JSON array or object" -- `--slurp` is what would merge them into one
# array first, and this script does not pass it), so ONE "N <count>" row is emitted per page,
# not once for the whole result set. Summing every "N " row -- not just the first -- is what
# stays correct on an ordinary >30-file PR (this endpoint pages at 30, per the COMPLETENESS
# comment below); reading only the first N row would fail-closed on every such PR, which is its
# own bug (see this todo's Risks: over-tightening reaches the merge gate as "review required"
# and reads as the gate itself being broken).
#
# This check is NOT what defeats the newline-forgery attack -- the B sentinel above is, by
# construction: a refused item never reaches "F "/"N "-shaped text at all, so it cannot also
# forge a compensating "N " row to keep this sum balanced. By the time this comparison runs, B
# has already ruled out every newline-bearing name, so this is a second, independent structural
# cross-check: `length` is jq's own count of the page's ACTUAL array elements, read from the
# JSON before any flattening, so unlike a `grep -c` over raw text it cannot be inflated by
# string content.
#
# Compared against the RAW (non-deduped) `F ` count, not the distinct count the COMPLETENESS
# check below uses: every element emits exactly one F row unconditionally (unless refused as
# B), so two real elements that happen to share a filename still contribute two real rows and
# two real N-counted elements. Distinct-F is a deliberately LOOSER measure for a different
# purpose (see the `sort -u` comment below); comparing distinct-F to N here would false-ERROR
# the legitimate same-name-twice-across-a-page-boundary case.
total_N="$(grep -oE '^N [0-9]+$' <<< "$raw_files" | awk '{s += $2} END {print s + 0}' || true)"
raw_F_count="$(grep -c '^F ' <<< "$raw_files" || true)"
case "$raw_F_count" in
  ''|*[!0-9]*)
    echo "guard: ERROR PR #$PR — could not count the flattened 'F' rows. Fail-closed."
    exit 2
    ;;
esac
case "$total_N" in
  ''|*[!0-9]*)
    echo "guard: ERROR PR #$PR — could not read the response's own count row(s). Fail-closed."
    exit 2
    ;;
esac
if [ "$raw_F_count" -ne "$total_N" ]; then
  echo "guard: ERROR PR #$PR — the flattened output carries $raw_F_count 'F' rows but the response's own count row(s) total $total_N entries; the row count does not match the count row. Fail-closed."
  exit 2
fi

# COMPLETENESS. Count DESTINATION rows only (`F `) and compare against the PR's declared
# changed-FILE count: the two sides must measure the same unit.
#
# An earlier version of this check counted LINES, on the reasoning that rename sources only ever
# ADD lines so the count can never fall below the declared total spuriously. That reasoning is
# sound in one direction and the code depends on the OTHER: `seen < declared` really does imply
# truncation, but the check acts on the converse, `seen >= declared` implying complete, and that
# is false. Every rename source is an extra line, so R renames MASK R files truncated away.
# Measured before the fix: declared 3, rows [archive, a renamed file, a .claude/agents/ markdown];
# drop the third row to model truncation and 2 destinations + 1 rename source = 3 lines >= 3
# declared, so the guard returned OK and the protected markdown went from HOLD to a merge-gate
# pass -- the exact bypass this detector exists to prevent.
declared_files="$(gh pr view "$PR" --json changedFiles --jq .changedFiles)" || {
  echo "guard: ERROR PR #$PR — could not read the declared changed-file count. Fail-closed."
  exit 2
}
# `sort -u`: distinct DESTINATIONS. Duplicate rows -- possible across a page boundary under
# --paginate -- would otherwise inflate the count and mask a file truncated away. The numeric
# guard mirrors the one on declared_files below: `|| true` can yield an empty value, and
# `[ "" -lt N ]` returns rc 2 INSIDE the if, which SKIPS the truncation error rather than raising
# it. Not reachable today, but the fail-closed direction should be structural, not incidental.
seen_files="$(grep '^F ' <<< "$raw_files" | sort -u | grep -c . || true)"
case "$seen_files" in
  ''|*[!0-9]*)
    echo "guard: ERROR PR #$PR — could not count the changed paths that were read. Fail-closed."
    exit 2
    ;;
esac
case "$declared_files" in
  ''|*[!0-9]*)
    echo "guard: ERROR PR #$PR — declared changed-file count is not a number ('$declared_files'). Fail-closed."
    exit 2
    ;;
esac
if [ "$seen_files" -lt "$declared_files" ]; then
  echo "guard: ERROR PR #$PR — read $seen_files changed paths but the PR declares $declared_files changed files, so the list is truncated and some paths were never gated. Fail-closed."
  exit 2
fi

# Body intentionally left un-indented: wrapping ~55 existing lines in this conditional
# would reindent all of them and bury the one-line behavioural change in whitespace.
if [ -z "$PATHS_ONLY" ]; then
# ── TODO GATE ─────────────────────────────────────────────────────────────────
# The todo's priority and labels ride the PR as todos/archive/<slug>.md frontmatter —
# the PR itself carries no GitHub label. Parse it from the PR head. Fail-closed at
# every step: no archived todo in the diff, unreadable content, or a priority other
# than low ⇒ HOLD. Any mention of "security" ANYWHERE in the frontmatter
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
      echo "guard: HOLD PR #$PR — ${tf} is listed in the diff but absent from the PR head (deleted, or renamed away — this path may be a rename SOURCE, which this gate now reads deliberately); cannot verify frontmatter"
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
    low) : ;;
    *)
      echo "guard: HOLD PR #$PR — ${tf} has priority '${prio:-<missing>}'; only low todos are batch-merge-eligible"
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
fi

# ── PATH GATE ─────────────────────────────────────────────────────────────────

# A file passes only if (1) it is on the allowlist, (2) it is not one of the
# STRUCTURALLY sensitive whole-directory / exact-path entries (checked for EVERY file,
# markdown included — this is what closes the markdown-exemption bypass: every
# whole-directory SENSITIVE_OVERRIDE entry had a silent `\.md$` bypass through the
# exemption when it ran first), and (3) — unless it is a doc/todo/markdown file that
# survived (2), which is never sensitive CODE — it does not hit the full,
# keyword-bearing sensitive override. ANY other outcome HOLDs: not allowlisted,
# structurally sensitive, sensitive, or a grep regex ERROR (rc >= 2). Exit codes are
# captured explicitly so a broken regex (rc 2) can never look like a clean "no match"
# (rc 1) — a typo fails CLOSED, never silently passes as eligible.
unsafe=""
while IFS= read -r f; do
  [ -z "$f" ] && continue
  # 1) must be on the allowlist
  if ! printf '%s' "$f" | grep -qE "$SAFE_ALLOWLIST"; then
    unsafe="${unsafe}  ${f}"$'\n'; continue
  fi
  # 2) structural sensitivity — whole-directory and exact-path entries ONLY, checked
  #    BEFORE the markdown exemption below so markdown can never escape it. Deliberately
  #    NOT the full SENSITIVE_OVERRIDE: that regex also carries free-text keywords meant
  #    to classify CODE by filename, and running those over prose HOLDs any doc/todo
  #    whose slug happens to contain an everyday word (see STRUCTURAL_SENSITIVE's comment).
  #    The rc is captured explicitly rather than written as `… && ! grep -qE "$STRUCTURAL_SENSITIVE"`:
  #    under negation a BROKEN regex (rc >= 2) inverts to true, takes the exemption, and skips the
  #    sensitive check — fail-OPEN, the exact trap step 4's rc_sens capture exists to avoid. Here
  #    rc 1 (clean no-match) is the ONLY value that may skip the HOLD; rc 0 (structurally
  #    sensitive) and rc >= 2 (regex error) both HOLD.
  rc_struct=0; printf '%s' "$f" | grep -qiE "$STRUCTURAL_SENSITIVE" || rc_struct=$?
  if [ "$rc_struct" -ne 1 ]; then
    unsafe="${unsafe}  ${f}"$'\n'; continue
  fi
  # 3) docs / todos / markdown that survived (2) are never sensitive CODE — they pass on
  #    the allowlist alone (a todo slug like subscription-tier-ui.md must not trip the
  #    override). Every OTHER docs/todos path — docs/solutions/, docs/research/, todos/,
  #    runbooks — keeps the exemption; that high-volume, low-risk case is what the
  #    exemption exists for.
  if printf '%s' "$f" | grep -qE '^(docs|todos)/|\.md$'; then
    continue
  fi
  # 4) an allowlisted, structurally-clean CODE file that hits the full keyword-bearing
  #    sensitive override HOLDs. rc 1 (clean no-match) is the ONLY pass; rc 0 (sensitive)
  #    and rc >= 2 (regex error) both HOLD.
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
