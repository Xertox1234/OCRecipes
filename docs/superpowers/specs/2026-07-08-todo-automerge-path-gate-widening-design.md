# Widen the todo auto-merge path gate

## Problem

`scripts/todo-automerge-guard.sh` decides whether a low/medium-priority,
non-`security` `/todo` PR is eligible for GitHub's native auto-merge. It runs
two gates: a TODO gate (priority + no `security` mention) and a PATH gate
(every changed file must be on a narrow allowlist). The PATH gate's allowlist
lists specific subdirectories rather than roots — `client/components/`,
`client/screens/`, `client/navigation/`, `client/constants/`,
`server/services/`, and a handful of `shared/*` subdirs — so any todo that
touches `server/routes/` or `server/storage/` HOLDs for manual review
regardless of priority, even though by that point it has already passed:

- Full CI (8 required checks)
- A `code-reviewer` + 1–2 domain-reviewer subagent pass during execution
- The TODO gate itself (priority low/medium, no `security` label)

This produces PRs that are functionally ready to merge but sit in the user's
manual-review queue purely because of which directory they touched, not
because of any actual risk signal.

## Rejected approach: flip PATH gate to a denylist

The initial ask was to invert the model — deny-by-default instead of
allow-by-default, so anything not explicitly excluded is eligible. This is
rejected: the guard's own header comment documents that an earlier revision
of this exact gate "was found fail-OPEN on whole sensitive layers —
`server/storage`, `.github`, `scripts` — so this inverts it: a path is unsafe
unless proven safe." `docs/LEARNINGS.md:1378` states the same principle
generally: "Denylists fail open when new columns are added to the schema;
allowlists fail closed." A true denylist means any brand-new, never-enumerated
path (a new top-level directory, a stray root config file) silently passes —
exactly the failure mode a merge gate must not have.

## Approach: widen the allowlist to roots, expand the sensitive override

Instead of changing the model, widen the existing allowlist's granularity
from subdirectories to whole roots, and add the auth-surface exclusions that
were previously protected only by omission (whole directories being absent
from the allowlist). This produces the same practical outcome as a denylist
for every path that exists in the repo today, while a genuinely unrecognized
path still fails closed.

### `SAFE_ALLOWLIST` changes

Before:

```
^client/components/|^client/screens/|^client/navigation/|^client/constants/|^server/services/|^shared/types/|^shared/schemas/|^shared/constants/|^shared/lib/|(^|/)__tests__/|\.test\.[jt]sx?$|\.spec\.[jt]sx?$|(-|\.)utils\.tsx?$|^docs/|^todos/|\.md$
```

After (initial design, since revised — see "Incident: `server/routes/` reverted
to HOLD-by-default" below for the shipped value):

```
^client/|^server/routes/|^server/storage/|^server/services/|^shared/types/|^shared/schemas/|^shared/constants/|^shared/lib/|(^|/)__tests__/|\.test\.[jt]sx?$|\.spec\.[jt]sx?$|(-|\.)utils\.tsx?$|^docs/|^todos/|\.md$
```

**Shipped (final):**

```
^client/|^server/storage/|^server/services/|^shared/types/|^shared/schemas/|^shared/constants/|^shared/lib/|(^|/)__tests__/|\.test\.[jt]sx?$|\.spec\.[jt]sx?$|(-|\.)utils\.tsx?$|^docs/|^todos/|\.md$
```

- The four `client/...` entries collapse into one `^client/` root (strictly
  broader — every path any of the four matched, the new one also matches).
- `^server/storage/` is new; `^server/routes/` was added, then removed again
  (see the incident section below) — it never shipped.
- `server/services/` and the `shared/*` subdirs are unchanged.
- `server/routes/`, `server/middleware/`, `server/scripts/`, `server/lib/`,
  `server/utils/`, `server/certs/`, top-level `migrations/`, `.github/`, top-level
  `scripts/`, and `shared/schema.ts` remain absent from the allowlist — held by
  omission, same as today. This is a deliberate scope limit: only one new
  directory (`server/storage/`) opens up; nothing else does.

### Incident: `server/routes/` reverted to HOLD-by-default

The initial design above widened `server/routes/` alongside `server/storage/`,
compensating with `SENSITIVE_OVERRIDE` entries for the sensitive files an audit
of the directory found. A final whole-branch review, run after all four
planned tasks were implemented and individually approved, found this
insufficient: real auth-security logic — `server/routes/_rate-limiters.ts`
(login/account brute-force lockout), `server/routes/_schemas.ts`
(password-strength rules), `server/routes/_upload.ts` (file-type/size
validation), and `server/routes/public-api.ts` (external API-key auth) — all
imported by `auth.ts`, matched no `SENSITIVE_OVERRIDE` token or
`SENSITIVE_INTENT_KEYWORDS` word. A todo titled e.g. "Consolidate route
rate-limiter constants" would have passed both gates and auto-merged
unreviewed.

This is structurally the same failure this spec's "Rejected approach" section
warned about: enumerating sensitive files inside an opened root is a denylist
operating inside that root, and denylists fail open for anything not yet
enumerated. The difference from the top-level rejected-denylist option is
scope — here it was one root, not the whole gate — but the failure mode is
identical, and it manifested for real within the same PR that documented the
principle.

Presented to the user as a design choice (patch the four known holes vs.
revert `server/routes/` to HOLD-by-default): the user chose the revert.
`server/routes/` now HOLDs wholesale, the same way `server/middleware/`
always has — it is the request/authz boundary, the one root judged not worth
opening even at the cost of giving up some auto-merge coverage for routes
todos. `client/` and `server/storage/` stayed widened.

### Incident: `client/lib/query-client.ts` and `reporter.ts`

The same review, asked to specifically hunt `client/` and `server/storage/`
for the identical hidden-security-logic pattern, found two more matches in
`client/`: `query-client.ts` (attaches the Bearer token to every API call,
detects session death) and `reporter.ts` (`scrubEvent` strips `Authorization`
headers before Sentry). Neither matched any `SENSITIVE_OVERRIDE` token.

Unlike the routes case, both files already had adversarial tests pinning the
security property itself (asserting the header is stripped; exercising the
session-expiry path) — an obvious regression fails CI before it can
auto-merge, which the routes files' rate-limit/password-schema _values_ had
no equivalent test for. On that basis, and because reverting `client/`
wholesale would give up most of this widening's value, the fix was to name
both files in `SENSITIVE_OVERRIDE` rather than revert the root. This is a
residual-risk acceptance, not a claim that `client/` and `server/storage/`
have been exhaustively audited for every such file — the `SAFE_ALLOWLIST`
comment in the shipped script says so explicitly, and the PR body invites the
user to request the same fail-closed treatment for either root if they'd
rather not carry that risk.

### Incident: xhigh-effort review found 15+ more, then a drift-detection test

Right on schedule, that residual risk materialized. Before merge, an
extra-high-effort automated code review (10 finder angles, independent
verification, a sweep pass) re-ran the same hunt across the roots the PR
still left open and found 18 more matches: 10 `client/hooks/*` files doing
the identical Bearer-token-attachment pattern as `query-client.ts` (one of
them, `useCookSession.ts`, was already asserted "confirmed non-sensitive" by
this PR's own test), plus `offline-queue-drain.ts`, `photo-upload.ts`,
`durable-owner.ts`, three health-PII files, and one-off instances in
`server/storage/export.ts` and `server/services/email.ts`. Separately, a
pre-existing bypass let files under `server/routes/`/`.github/`/`scripts/`/
`migrations/` slip past the allowlist via directory-independent test/spec/
utils tokens, and a companion gap sat in `todo-executor.md`'s separate
research-delegation skip-gate.

This was the fourth occurrence of the same structural problem inside one PR
(routes → query-client/reporter → this). The user was asked, explicitly:
patch the 18 known files and move on, or add a mechanism that makes the
_next_ one fail loudly instead of silently. They chose the mechanism. The
fix: the 18 files are named in `SENSITIVE_OVERRIDE` (so the suite starts
green), plus a **drift-detection test** in
`scripts/__tests__/todo-automerge-guard.test.ts` that re-runs the
Bearer-token-attachment hunt (`tokenStorage` + `Authorization` co-occurring
in a file) as a CI-enforced check — any future file matching that signature
must be in `SENSITIVE_OVERRIDE` or the test fails.

Health-PII was deliberately NOT given the same automated treatment. A
broader "any file referencing `allergies`/`healthConditions`" signature was
tried and rejected: it matched 10+ legitimate downstream consumers of
already-captured profile data (recipe personalization, AI coach context,
carousel building) that are core product logic for this app, not new
chokepoints — automating it would have meant a huge swath of ordinary
feature code failing the drift test. The lesson generalizes: a
drift-detection signature is only safe to automate when it's narrow enough
that a match is _always_ a genuine new chokepoint, never routine business
logic. Bearer-token attachment (a mechanical, single-purpose operation) met
that bar; health-PII propagation (a domain concept woven through the app's
actual feature set) didn't. See `docs/solutions` for the codified version of
this lesson.

### `SENSITIVE_OVERRIDE` changes

Before:

```
receipt-validation|store-notification|(^|/)subscription|(^|/)iap[./-]|apple-?iap|google-?(iap|play)|app-store-server|in-app-purchase|entitlement|(^|/)[Hh]ealth
```

**Verification, not assumption.** Before finalizing this list, `find server/routes
server/storage client -iname '*auth*' -o -iname '*session*' -o -iname
'*verif*' -o -iname '*password*' -o -iname '*login*' -o -iname '*admin*' -o
-iname '*token*' -o -iname '*premium*' -o -iname '*store-webhook*'` (excluding
`__tests__/`) was run against the actual repo to find every currently-existing
file in the two newly-opened roots that a path-pattern override needs to
cover. This surfaced concrete gaps the first draft of this spec missed by
reasoning about the change in the abstract rather than checking the real
directory contents:

| File                                                                                                                                                          | Covered by original plan?                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `server/routes/auth.ts`                                                                                                                                       | yes (`server/routes/auth`)                                                                                                                                                                                                                                               |
| `client/context/AuthContext.tsx`, `client/hooks/useAuth.ts`                                                                                                   | yes                                                                                                                                                                                                                                                                      |
| `client/lib/token-storage.ts`                                                                                                                                 | yes (`token-storage`)                                                                                                                                                                                                                                                    |
| `client/screens/VerifyEmailScreen.tsx(-utils.ts)` (email-verification UI, confirmed by reading its imports: `verifyEmailRequest`/`resendVerificationRequest`) | **no**                                                                                                                                                                                                                                                                   |
| `server/routes/store-webhooks.ts` (Apple/Google IAP webhook receiver)                                                                                         | **no** — doesn't match `store-notification`                                                                                                                                                                                                                              |
| `server/storage/users.ts` (27.5K — the mass-assignment/role-escalation-risk file, `docs/LEARNINGS.md:1359`)                                                   | **no** — sensitive by _content_, filename gives no signal                                                                                                                                                                                                                |
| `server/storage/sessions.ts` (auth session storage)                                                                                                           | **no** — no `session` keyword existed                                                                                                                                                                                                                                    |
| `client/components/SessionExpiryBridge.tsx` (auth session UI)                                                                                                 | **no**                                                                                                                                                                                                                                                                   |
| `server/routes/_admin.ts`, `admin-api-keys.ts`, `admin-search-index.ts`                                                                                       | **no**                                                                                                                                                                                                                                                                   |
| `client/context/PremiumContext.tsx`, `client/hooks/usePremiumFeatures.ts` (subscription-gating logic)                                                         | **no**                                                                                                                                                                                                                                                                   |
| `client/screens/LoginScreen.tsx(-utils.ts)`                                                                                                                   | **no**                                                                                                                                                                                                                                                                   |
| `server/storage/api-keys.ts` (partner-API-key storage — same content-sensitive-by-nature class as `users.ts`)                                                 | **no** — its sibling `server/routes/admin-api-keys.ts` is only caught by luck (the `admin` keyword), which is the tell that the filename audit's keyword list (auth/session/verif/password/login/admin/token/premium/store-webhook) never included key/secret/credential |

**Pre-existing gap, independent of this widening.** `client/screens/` and
`client/components/` are already on today's _unmodified_ `SAFE_ALLOWLIST`,
and today's `SENSITIVE_OVERRIDE` has no `login`/`session` pattern at all.
That means `client/screens/LoginScreen.tsx(-utils.ts)` and
`client/components/SessionExpiryBridge.tsx` are **already** eligible for
auto-merge right now, before any change in this spec — a live gap in the
current script, found as a side effect of auditing it, not caused by the
widening. It's fixed by the same override additions above (same file, same
regex, same PR) and is in scope per this project's "fix a discovered defect
now, don't defer it" policy — it isn't a new risk introduced by opening
`server/routes/`/`server/storage/`.

**Correction: "verification" is the wrong signal — checked by reading the
actual code, not assumed.** An earlier draft of this spec added a bare
`[Vv]erif` pattern on the assumption that anything with "verification" in
its name was email/account-verification (auth-adjacent). Reading the files
directly disproved this: `server/routes/verification.ts` (530 lines),
`server/storage/verification.ts` (399 lines), `client/components/
VerificationBadge.tsx`, and `verification-badge-utils.ts` are **all** part
of the "Verified Product API" — the barcode/nutrition-data verification
feature (`barcodeVerifications`, `verificationHistory`,
`GET /api/verification/:barcode`, `VerificationLevel` in
`shared/types/verification.ts`). This is core, frequently-touched product
business logic with nothing to do with auth — per project memory this is
literally a sellable data asset, not a security surface. A bare `[Vv]erif`
pattern would have permanently blocked a major feature area from ever
auto-merging, directly undermining this widening's purpose. Only
`client/screens/VerifyEmailScreen.tsx(-utils.ts)` is genuinely
auth-adjacent (confirmed by reading its imports — it calls
`verifyEmailRequest`/`resendVerificationRequest`, defined in its own
`-utils.ts`, which is the actual email-verification client flow). The fix:
use the precise `VerifyEmailScreen` pattern instead of the broad `[Vv]erif`
substring — narrow enough to exclude the Verified Product API files
entirely, still catching the one real auth-UI surface.

Deliberately _not_ added, and confirmed non-sensitive: `client/hooks/useCookSession.ts`,
`useQuickLogSession.ts`, `client/lib/cook-session-storage.ts`,
`client/screens/CookSessionCaptureScreen.tsx` / `CookSessionReviewScreen.tsx`
(an unrelated "cook-along session" feature — a bare `session` keyword would
have swept these in as a false positive and defeated part of the point of
this widening); `server/routes/push-tokens.ts`, `server/storage/push-tokens.ts`,
`client/lib/push-token-registration.ts` (Expo push tokens — a different,
non-sensitive kind of "token"); `server/routes/receipt.ts`,
`server/storage/receipt.ts` (grocery receipt OCR, already explicitly
documented in the guard's own comments as distinct from IAP `receipt-validation`).

After:

```
receipt-validation|store-notification|store-webhook|(^|/)subscription|(^|/)iap[./-]|apple-?iap|google-?(iap|play)|app-store-server|in-app-purchase|entitlement|(^|/)[Hh]ealth|(^|/)server/middleware/|(^|/)server/routes/auth|token-storage|AuthContext|useAuth|VerifyEmailScreen|(^|/)server/storage/users\.ts$|(^|/)sessions\.ts$|SessionExpiryBridge|admin|Premium|[Ll]ogin|api-key|secret|credential
```

`api-key` closes the concrete gap found above. `secret|credential` have no
matching file today (confirmed by re-running the same directory sweep with
`-iname '*secret*' -o -iname '*credential*'` — nothing hit), but are added
anyway: this override already accepts broad, evidence-cheap keywords
specifically because a false-positive HOLD costs nothing and a false
negative here is a real risk. Omitting them because no file happens to use
that name _yet_ is exactly the reasoning that missed `api-keys.ts` the first
time.

Notes on the merged pattern:

- `verification-token` (from the original plan) is dropped — no file in the
  repo matches it, and its intended target (email verification) is now
  covered precisely by `VerifyEmailScreen`.
- `VerifyEmailScreen` replaces the earlier, broader `[Vv]erif` — see the
  "Correction" note above. Broad-is-safe is the right default for a
  false-positive-tolerant override (used elsewhere in this same regex for
  `admin`/`Premium`/`[Ll]ogin`), but only when the broad match doesn't
  collide with an existing, actively-developed feature domain. Here it did:
  `[Vv]erif` would have permanently held the entire Verified Product API.
  The lesson generalizes — "broad is safe" needs a check against what the
  pattern _actually_ matches in the repo, not just against today's known
  sensitive files.
- `(^|/)sessions\.ts$` is anchored and case-sensitive specifically so it does
  **not** match `useCookSession.ts` / `QuickLogSession.ts` (different
  capitalization, not a standalone `sessions.ts` filename) — those stay
  eligible.
- `admin`, `Premium`, `[Ll]ogin` are broad substrings; accepted as
  intentionally broad for the same false-positive-is-cheap reason.
- `(^|/)server/middleware/`: a no-op for the guard's own gate 1 (that
  directory is still absent from `SAFE_ALLOWLIST`, so it never reaches gate
  3), but load-bearing for `todo-executor.md`'s separate skip-gate, which
  will be simplified to read this single constant instead of duplicating the
  pattern (see below). Document this in a script comment so a future editor
  doesn't "clean up" what looks like dead code.

**Residual risk, stated honestly.** `server/storage/users.ts` is explicitly
named in the override above precisely because it's a _known_ content-sensitive
file with an innocuous name — but the fact that it needed a special-case entry
at all is the real lesson: no path/filename list can ever be complete. The
_next_ sensitive file that gets added to the codebase with a name nobody
thinks to list will slip through this gate alone, exactly as `users.ts` would
have before this audit found it. That residual — for files not yet
discovered — is what the second, independent layer below (the
sensitive-intent keyword check on the todo's own title/frontmatter) actually
protects against, not `users.ts` itself (which both layers now cover).

### TODO gate: sensitive-intent keyword check (new second layer)

The existing TODO gate already scans the archived todo's frontmatter for the
word `security` (case-insensitive, anywhere in the frontmatter block — which
includes `title:` per `todos/TEMPLATE.md`). Add a second, equally-scoped
check for a broader sensitive-domain keyword list, HOLDing if the _todo
itself_ is about a sensitive domain — independent of which file it happens to
touch:

```bash
SENSITIVE_INTENT_KEYWORDS='auth|jwt|login|password|admin|premium|subscription|iap|api-key|credential'
...
if grep -qiE "$SENSITIVE_INTENT_KEYWORDS" <<< "$fm"; then
  echo "guard: HOLD PR #$PR — ${tf} frontmatter/title mentions a sensitive-domain keyword; always individual review"
  exit 1
fi
```

This backstops the class of risk `server/storage/users.ts` illustrates: a
todo whose _title_ is about user roles, passwords, or account data will HOLD
regardless of which specific file it ends up touching — including some
not-yet-discovered file this audit didn't find.

**Calibration: this list is deliberately narrower than `SENSITIVE_OVERRIDE`,
verified against realistic titles, not assumed.** An earlier draft also
included `session`, `verif`, `receipt`, `secret`, and `health` here, matching
the override. Running actual candidate titles through the regex disproved
the "routine work won't mention these words" assumption:

| Title (a plausible real low/medium todo)     | Matched   | Should HOLD?                                                                                                                |
| -------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------- |
| "Add secret ingredient field to recipe form" | `secret`  | No — ordinary recipe UI copy                                                                                                |
| "Fix grocery receipt OCR crash"              | `receipt` | No — the guard's own comments already document grocery-receipt OCR as non-sensitive, distinct from IAP `receipt-validation` |
| "Improve cook session review screen"         | `session` | No — the unrelated cook-along feature this same spec deliberately kept eligible in the path override                        |
| "Improve barcode verification accuracy"      | `verif`   | No — the Verified Product API, per the correction above                                                                     |
| "Add health score to recipe card"            | `health`  | No — ordinary nutrition-app feature copy                                                                                    |
| "Improve healthy-recipe filter"              | `health`  | No — same                                                                                                                   |
| "Show health insights on dashboard"          | `health`  | No — same                                                                                                                   |

Each of these would have silently defeated the widening for a real feature
area, re-introducing by a different mechanism the exact problem this spec
set out to fix. The five keywords are dropped from
`SENSITIVE_INTENT_KEYWORDS` (not from `SENSITIVE_OVERRIDE`, where they match
specific file paths rather than free-text titles and don't have this
collision). Removing session/verif/receipt/secret is a clean trade: `server/
storage/sessions.ts`, `SessionExpiryBridge`, and `VerifyEmailScreen` are
already covered by name in `SENSITIVE_OVERRIDE`; `receipt-validation` (IAP)
is already covered there too, distinctly from plain `receipt.ts`. Dropping
`health` has a small residual cost, not a clean trade: `(^|/)[Hh]ealth` in
`SENSITIVE_OVERRIDE` only catches health-_named_ paths (e.g. `HealthScore.tsx`,
`HealthConditionsScreen.tsx`), but health-PII also lives in innocuously named
files this repo already has — `server/storage/profile-hub.ts`,
`server/lib/dietary-context.ts`, `client/screens/onboarding/
HealthDataConsentScreen.tsx`'s companion data flow — the exact class of gap
`server/storage/users.ts` motivated this whole second layer to backstop. A
todo that touches one of those files under a health-flavored title (e.g.
"Add health score to recipe card" touching `profile-hub.ts`) now relies on
CI + review alone, not this gate. The trade is accepted because the false-HOLD
rate `health` produces is large and certain (ordinary nutrition-app feature
work routinely uses the word) while the exposure is small and still behind
two remaining gates (CI, subagent review) — but it is a real, named trade,
not a free one. A todo about real password/account-data risk still mentions
`auth`, `jwt`, `login`, `password`, `admin`, `premium`, `subscription`,
`iap`, `api-key`, or `credential` — the remaining list — with no comparable
domain-vocabulary collision found in this app's actual feature set. A todo
genuinely about routine, non-sensitive work (recipe search, meal-plan UI,
nutrition lookups, cook sessions, grocery receipts, product verification,
health-adjacent recipe features) won't mention any of the remaining words
and is unaffected — this layer doesn't narrow the widening for the bulk of
routine todos, it only backstops the sensitive-sounding ones.

`SENSITIVE_INTENT_KEYWORDS` should live in the guard script as the single
source of truth, the same way `SENSITIVE_OVERRIDE` already is — and
`todo-executor.md:92`'s existing prose ("the todo title or labels mention
auth, JWT, login, session, token, IAP, receipt, or subscription") should be
updated to source this variable at runtime instead of hardcoding an
independent copy of the same list, for the same DRY reason `SENS` is already
sourced.

### Net effect (shipped state — after both incidents above)

| Path                                                                                                          | Before                                                                                                 | After                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `server/routes/recipes.ts`, `server/routes/meal-suggestions.ts`                                               | HOLD (not on allowlist)                                                                                | HOLD (not on allowlist — `server/routes/` reverted to HOLD-by-default; the initial design's "eligible" for this row never shipped, see incident above)      |
| `server/routes/auth.ts`                                                                                       | HOLD (not on allowlist)                                                                                | HOLD (not on allowlist — `server/routes/` HOLDs wholesale, not via a path-override entry; the initial design's `(^                                          | /)server/routes/auth` override entry was dropped as dead code) |
| `server/routes/_rate-limiters.ts`, `_schemas.ts`, `_upload.ts`, `public-api.ts`                               | HOLD (not on allowlist)                                                                                | HOLD (not on allowlist — the specific fail-open files the incident found; would have been "eligible" under the initial design)                              |
| `server/storage/meal-plans.ts`                                                                                | HOLD (not on allowlist)                                                                                | eligible                                                                                                                                                    |
| `server/storage/users.ts`                                                                                     | HOLD (not on allowlist)                                                                                | HOLD (path override — explicit exact-file entry)                                                                                                            |
| `server/storage/sessions.ts`, `client/components/SessionExpiryBridge.tsx`                                     | HOLD (not on allowlist)                                                                                | HOLD (path override, anchored to avoid the unrelated cook-session feature)                                                                                  |
| `client/screens/VerifyEmailScreen.tsx`                                                                        | HOLD (not on allowlist)                                                                                | HOLD (path override, `VerifyEmailScreen`)                                                                                                                   |
| `server/routes/verification.ts` (Verified Product API)                                                        | HOLD (not on allowlist)                                                                                | HOLD (not on allowlist — `server/routes/` HOLDs wholesale; holds for the same reason `recipes.ts` does, NOT because it's flagged sensitive)                 |
| `server/storage/verification.ts`, `client/components/VerificationBadge.tsx` (Verified Product API — not auth) | HOLD (not on allowlist)                                                                                | eligible — deliberately NOT held; see the "Correction" note above                                                                                           |
| `server/routes/store-webhooks.ts`, `_admin.ts`, `admin-api-keys.ts`                                           | HOLD (not on allowlist)                                                                                | HOLD (not on allowlist — `server/routes/` HOLDs wholesale; these would also still match their original override tokens, but that's no longer why they hold) |
| `client/context/PremiumContext.tsx`                                                                           | HOLD (not on allowlist)                                                                                | HOLD (path override)                                                                                                                                        |
| `client/screens/LoginScreen.tsx`                                                                              | HOLD (not on allowlist)                                                                                | HOLD (path override)                                                                                                                                        |
| `client/lib/query-client.ts`, `client/lib/reporter.ts`                                                        | HOLD (not on allowlist)                                                                                | HOLD (path override — added by the second incident above; would have been "eligible" without it)                                                            |
| `server/storage/api-keys.ts`                                                                                  | HOLD (not on allowlist)                                                                                | HOLD (path override — `api-key`)                                                                                                                            |
| `server/middleware/anything.ts`                                                                               | HOLD (not on allowlist)                                                                                | HOLD (not on allowlist, unchanged)                                                                                                                          |
| `client/hooks/useSomething.ts`                                                                                | HOLD (not on allowlist — only components/screens/navigation/constants were)                            | eligible                                                                                                                                                    |
| `client/hooks/useCookSession.ts`                                                                              | HOLD (not on allowlist)                                                                                | eligible (confirmed non-sensitive, deliberately not swept in by the session pattern)                                                                        |
| `client/context/AuthContext.tsx`                                                                              | HOLD (not on allowlist)                                                                                | HOLD (path override)                                                                                                                                        |
| `migrations/0042_x.sql`                                                                                       | HOLD (not on allowlist)                                                                                | HOLD (unchanged)                                                                                                                                            |
| `infra/new-thing.yml` (hypothetical, never seen before)                                                       | HOLD (not on allowlist)                                                                                | HOLD (not on allowlist, unchanged)                                                                                                                          |
| any file, if the todo's title/frontmatter mentions auth/session/admin/premium/etc.                            | HOLD (via existing `security`-only check, unless the todo happened to also carry a `security` mention) | HOLD (intent gate, regardless of which file)                                                                                                                |

## Docs to sync

These all describe the old narrow allowlist and would otherwise contradict
the script after this change:

- `.claude/agents/todo-executor.md`:
  - Lines 92–101 (skip-gate for research delegation): simplify the grep to
    reuse `"$SENS"` directly instead of re-appending
    `(^|/)server/middleware/|(^|/)server/routes/auth|verification-token|token-storage|AuthContext|useAuth`
    — that alternation now lives in the guard's `SENSITIVE_OVERRIDE` itself,
    so duplicating it here is a drift risk (the whole point of sourcing
    `SENS` at runtime was to have one definition). Also source the new
    `SENSITIVE_INTENT_KEYWORDS` constant instead of the hardcoded prose list
    ("auth, JWT, login, session, token, IAP, receipt, or subscription") at
    line 92, for the same reason.
  - Line 541 (merge-eligibility prose): update the example HOLD paths —
    `server/storage`, `server/routes` are no longer categorically excluded;
    replace with `server/middleware`, `.github/`, `scripts/`, `migrations`,
    `shared/schema.ts`. Mention the new intent-keyword HOLD reason so the
    Phase 5 report's "(guard: <reason line>)" makes sense when it fires.
- `.claude/skills/todo/SKILL.md` line 373: same prose update.
- `docs/todo-automation-runbook.md` lines 46–58: same prose update ("whole
  sensitive backend" list needs the same correction).

## Header comment fix (opportunistic, in scope)

`scripts/todo-automerge-guard.sh`'s top comment still describes the
pre-2026-07-06 model: "MODEL (since #487 — NO PR ever auto-merges; this
script only CLASSIFIES)." This contradicts the current, restored behavior
(guard-eligible PRs auto-merge via `gh pr merge --auto`, per the executor and
`docs/todo-automation-runbook.md`). Fix this comment as part of the same
edit — leaving contradictory documentation in the file being changed is how
the next person misreads the gate.

## Tests (TDD)

No existing test covers this script. New file:
`scripts/__tests__/todo-automerge-guard.test.ts`, spawning the real bash
script as a subprocess with a stub `gh` executable prepended to `PATH` (the
script's only two external calls are `gh pr diff <pr> --name-only` and
`gh api ... contents/<path>?ref=refs/pull/<pr>/head`; the stub pattern-matches
on argv and returns canned fixture output).

Write the negative/regression cases first — this is where an allowlist
widening fails open if done wrong:

1. `server/middleware/logging.ts` in the diff → still HOLD (gate 1, absent
   from allowlist).
2. `server/routes/auth.ts` in the diff → still HOLD (gate 3, path override),
   even though `server/routes/` is now broadly allowed.
3. `client/context/AuthContext.tsx` → still HOLD (gate 3).
4. `migrations/0042_x.sql`, `.github/workflows/ci.yml`, `scripts/anything.sh`,
   `shared/schema.ts` → still HOLD (gate 1, unchanged).
5. An IAP/health path (e.g. `server/services/receipt-validation.ts`) → still
   HOLD (gate 3, unchanged existing behavior — regression guard).
6. A genuinely unrecognized top-level path (e.g. `infra/foo.yml`) → still
   HOLD (gate 1) — proves the widened allowlist did not become fail-open.
7. `high`/`critical` priority or a `security`-labelled todo → still HOLD
   (TODO gate, unchanged).
8. `server/storage/meal-plan-analytics.ts` (an ordinary, newly-opened storage
   file with no path-override match) with a todo titled "Fix admin password
   reset flow" → still HOLD (intent gate) — proves the intent gate catches a
   case the path override alone would miss, since this file isn't in either
   pattern list.
9. `server/storage/sessions.ts`, `client/screens/VerifyEmailScreen.tsx`,
   `server/routes/store-webhooks.ts`, `server/routes/_admin.ts`,
   `client/context/PremiumContext.tsx`, `client/screens/LoginScreen.tsx`,
   `server/storage/api-keys.ts` → each still HOLD (gate 3, the newly-added
   path patterns) — proves the concrete gaps found during spec verification
   are actually closed.
10. A todo titled "Fix authentication redirect bug" touching an otherwise
    generic, allowlisted file (e.g. `client/screens/HomeScreen.tsx`) → still
    HOLD (intent gate fires independent of which file is touched).

Then the positive cases proving the actual feature:

11. `server/routes/recipes.ts` with a `low`-priority archived todo (generic
    title, e.g. "Fix pagination bug in recipe search") → OK (exit 0).
12. `server/storage/meal-plans.ts` with a `medium`-priority archived todo →
    OK (exit 0).
13. `client/hooks/useSomething.ts` (previously HELD — not on the old
    subdirectory list) → OK (exit 0).
14. `client/hooks/useCookSession.ts` with a generic title → OK (exit 0) —
    proves the anchored `sessions.ts` pattern does not sweep in the unrelated
    cook-along-session feature.
15. `server/routes/verification.ts`, `server/storage/verification.ts`,
    `client/components/VerificationBadge.tsx` with a generic title → OK
    (exit 0 each) — proves the Verified Product API stays eligible; the
    correction that motivated dropping the broad `[Vv]erif` pattern.
16. Each of the four recipe-domain titles from the calibration table with a
    generic, allowlisted file — "Add secret ingredient field to recipe
    form", "Fix grocery receipt OCR crash", "Improve cook session review
    screen", "Improve barcode verification accuracy" — → OK (exit 0 each) —
    proves the intent gate does not over-hold ordinary domain vocabulary
    after dropping `session`/`verif`/`receipt`/`secret` from
    `SENSITIVE_INTENT_KEYWORDS`.

## Rollout / risk

Pure automation-policy change to a local dev-tooling script; no runtime,
schema, or user-facing surface. Risk is scoped to "a todo that shouldn't have
auto-merged, did" — mitigated by the regression tests above, the two
independent gates (path override + the new sensitive-intent keyword check),
and the unchanged CI/review requirements upstream of this gate. No rollback
mechanism needed beyond reverting the commit; the guard is stateless per
invocation.
