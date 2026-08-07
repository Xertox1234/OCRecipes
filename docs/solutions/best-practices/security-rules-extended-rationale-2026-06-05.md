---
title: Security Rules — Extended Rationale & Failure Modes
track: knowledge
category: best-practices
module: server
severity: high
tags: [security, idor, mass-assignment, ai-prompting, premium-gating, consent, redos, supply-chain, pg-lab]
applies_to: [server/routes/**/*.ts, server/storage/**/*.ts, server/middleware/**/*.ts, server/services/**/*.ts, server/index.ts, server/lib/image-store.ts, server/scripts/**/*.ts, scripts/pg-lab/**/*.sh]
created: '2026-06-05'
last_updated: '2026-08-07'
---

# Security Rules — Extended Rationale & Failure Modes

`docs/rules/security.md` holds the **binding one-line directives** (kept short so the
PreToolUse pattern-injection hook can fit them inline alongside other domains). This file
holds the **full rationale, failure-mode walkthroughs, exact-pattern examples, and precedent
file paths** that used to live in those bullets. Read this when a terse rule isn't
self-explanatory or you need the "why" before changing security-sensitive code.

Each section below corresponds to a directive in `docs/rules/security.md`.

## IDOR & resource scoping

### isPublic guard on both read AND write paths
The `isPublic` guard must appear on BOTH the read path AND the write path of storage
functions that accept user-supplied IDs. A write path that inserts without filtering can
associate private resources with a user, leaking their metadata (title, cuisine, imageUrl)
via the subsequent read.

### Polymorphic-FK junction inserts verify the target, not the parent
Polymorphic-FK junction inserts (`(parent_id, target_id, target_type)`) must verify the
_target_ resource's ownership/visibility with its own `EXISTS` guard — verifying only the
junction's parent container is insufficient. A parent-only guard looks correct (there _is_ a
`WHERE EXISTS`) but scopes the wrong row, letting a caller attach another user's private
resource and leak its metadata via the resolve path. The resolve path must also hide
non-visible-but-existing targets without orphan-deleting them.
Precedent solution: `docs/solutions/logic-errors/polymorphic-junction-unverified-target-idor-2026-05-16.md`.

### Single-resource read takes userId as a required param
A single-resource read that takes a user-supplied id (`getCommunityRecipe(id, userId)`) must
take `userId` as a REQUIRED (non-optional) parameter and filter
`id = ? AND (isPublic OR authorId = userId)` in SQL — pushing the visibility/ownership check
into storage gives defense-in-depth that a future call-site cannot forget. Keep the
route-boundary check too. Note `authorId = NULL` is always false in SQL, so even a degenerate
empty `userId` fails safe to public-only, never "no filter."

### Batch id→metadata resolver scopes by the authorizing junction
A batch id→metadata resolver (e.g. ids → titles for a prompt/context map) must scope by the
relationship/junction table that AUTHORIZES the caller's access to those ids — never by the
resource's own visibility flag (`isPublic = true`). Filtering on the visibility flag is wrong
twice over: it silently DROPS rows the caller is legitimately entitled to but that later went
private (incomplete context, e.g. dismissed-recipe titles vanishing so the LLM re-suggests
them), AND it is not actually an IDOR guard (it still returns metadata for any public id the
caller passes). Scope via an `INNER JOIN` through the table that records the caller's
relationship to the id (dismissals, ownership, membership) with `userId` in the join
condition — the relationship row is the authorization, making the resolver self-enforcing
against arbitrary-id misuse. This requires the relationship table be append-only for the id
(don't delete the link when the resource goes private). Precedent:
`getCommunityRecipeTitlesByIds` joins through `recipe_dismissals`
(`server/storage/community-recipes.ts`).

### Cross-user resource is indistinguishable from missing
A cross-user resource (session, record) must return the SAME response as a missing one —
never a distinguishable `403`. Collapse the existence check and the ownership check into one
guard (`if (!session || session.userId !== req.userId)`) so a caller cannot probe whether an
ID exists. Where the resource only contributes optional data (not a hard precondition),
resolve a cross-user hit to `undefined` and proceed exactly as if it were absent — do not
branch into a distinguishable error.

## Input validation & mass-assignment

Storage update functions must accept an explicit field whitelist — never `Partial<User>` or
spread of arbitrary input (enables mass-assignment). All route request bodies must be
Zod-validated before any field access — never `req.body.x` without a schema parse. `req.userId`
is a string (UUID) — never parse with `parseInt` (returns NaN, bypasses ownership checks
silently).

## AI / prompt boundary

Sanitize ALL prompt roles (`user`, `assistant`, `system`) before sending to OpenAI — never
only `user` role. Never trust parameters that "look server-generated" in AI prompt inputs —
always sanitize at the prompt boundary. Rate-limit all AI/OpenAI endpoints — every new AI
route needs a rate limiter from `server/middleware/rate-limiter.ts`.
Precedent solutions:
`docs/solutions/logic-errors/unsanitized-ai-prompt-parameter-question-2026-05-13.md`,
`docs/solutions/logic-errors/new-recipe-generation-endpoint-skipped-quota-2026-05-13.md`.

### ReDoS bounds on safety/classifier regexes
Classifier / safety regexes that consume across newlines must bound every `.*` and `[\s\S]*`
gap — never leave an unbounded quantifier, even on a new arm. Bound for consistency with the
file's existing bounded patterns, not just where the new arm is independently exploitable: an
unbounded arm next to bounded siblings re-trips every future ReDoS review and silently widens
the backtracking surface as the alternation grows. For a _safety / injection_ detector the
bound VALUE must be ≥ the upstream input-length cap (e.g. `[\s\S]{0,2000}` against a 2000-char
message limit) — a bound smaller than the input ceiling is itself a bypass: an attacker pads
the injection so the trigger keyword falls outside the gap. Pure routing heuristics may use a
tighter bound, since a miss only mis-routes rather than skipping a safety check. Note a single
quantifier followed by a literal (`ignore[\s\S]*(rule|...)`) backtracks LINEARLY — it is not
catastrophic ReDoS; only nested/overlapping quantifiers are. Bound it for hygiene, but size
the bound for coverage.

## Premium / subscription gating

Premium-gate BOTH read AND write endpoints for premium features — gating only the write path
leaves data readable for free.

### Effective tier (never index features by the raw stored tier)
Never index `TIER_FEATURES[tier]` for a USER subscription with the raw stored
`users.subscriptionTier` — the stored tier is NOT reset on expiry, so a raw-tier index grants
paid features/limits to lapsed subscribers (revenue leak).
**Primary path:** call `storage.getEffectiveTierForUser(userId)` (defined in
`server/storage/users.ts`) — a cache-free, single-storage-call helper that selects
`subscriptionTier + subscriptionExpiresAt` and applies `resolveEffectiveTier` internally,
returning the effective tier directly. Use it from route gates (`getPremiumFeatures`), storage
limit checks (`maxSavedItems`, `maxFavouriteRecipes`), and inline feature reads
(`extendedPlanRange`, `pantryTracking`).
**Niche-only fallback:** inline `resolveEffectiveTier(validatedTier, expiresAt)` from
`@shared/types/premium` (selecting `subscriptionExpiresAt` alongside the tier) is still valid
when you already hold a subscription record from a non-helper read (e.g.
`GET /api/subscription/status`) — do not re-fetch just to use the helper. The cached
`resolveSubscriptionTierFeatures` adds streak unlocks but pulls a `getUserVerificationStats`
dependency and a 60s cache — do NOT route per-request route gates through it (it breaks route
tests that mock only `getSubscriptionStatus` and leaks its cache across tests).
EXEMPTION: B2B `ApiTier` (api-key) sites have no expiry concept and must not be passed through
`resolveEffectiveTier` or `getEffectiveTierForUser`.

## Consent / audit timestamps (COPPA, CCPA/PIPEDA, ToS, age gate)

### Propagate the attestation, never hardcode it
Legal attestations / consent fields (COPPA age confirmation, ToS acceptance, marketing
opt-in) must be propagated as a parameter from the UI checkbox state through every
intermediate hook to the API call — never hardcode `true` in an auth hook or wrapper. The
server gate is still enforced (zero-trust client), but a hardcoded client bypass falsifies the
legal attestation record.

### Stamp server-side, generated inside storage, append-only
Consent / audit timestamps (CCPA/PIPEDA, terms acceptance, age gate) must be stamped
server-side from `new Date()` — clients send a boolean intent flag, never a timestamp; omit
the column from the Zod input schema so client-supplied values are silently dropped.

They must be generated INSIDE the storage function from `new Date()` and controlled by a
boolean `recordConsent`-style flag — never accept the timestamp as a parameter, even at the
storage layer. Also defensively destructure the column out of any caller-supplied spread
(`const { healthDataConsentAt: _strip, ...safe } = updates`) so a TS-bypassing caller
(`as any`, JS scripts) cannot smuggle a backdated `Date` into the SET clause.

They must be append-only at the storage layer — use SQL `COALESCE(existing, incoming)` in
partial updates and existence guards in transactional upserts so a re-stamp can never
overwrite the original record.

## CI / supply chain

`pull_request_target` workflows with repository secrets must execute only trusted base-branch
code — never checkout, source, import, install from, or execute PR-head files; fetch PR head
only as diff data.

## Deployment, storage & CLI surfaces

### Reverse proxy and `trust proxy`
Set `app.set("trust proxy", <hop count>)` numerically, never `true` — with `true`, Express takes
the leftmost `X-Forwarded-For` entry, which any client can spoof, so a caller can forge their
apparent IP. The failure mode is silent: a custom `keyGenerator` suppresses express-rate-limit's own
`ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` warning, so a topology change that collapses every request
into one shared bucket produces no error at all. The observed harm is a **global lockout**, not
merely lost per-client granularity — in the 2026-06-08 incident any 10 failed logins from anyone
locked out every user for 15 minutes, and more than 5 signups/hour from anywhere 429'd legitimate
registrations. A custom key generator buys silence, not safety.
Re-verify every `req.ip` consumer whenever the proxy topology changes. Trust platform client-IP
headers (`X-Real-IP`, `CF-Connecting-IP`) only when the read is gated on the platform that
overwrites them (e.g. `RAILWAY_ENVIRONMENT_NAME`).
Precedent: `docs/solutions/logic-errors/reverse-proxy-rate-limit-keying-2026-06-10.md`.

### Public-bucket / CDN object keys
Never derive a public object key from a user identifier. An unsalted hash of an *exposed* id is
still forward-computable — `authorId` is public via community recipes, so `sha256(userId)` can be
recomputed by anyone who can read an author id, turning "unguessable" keys into an enumeration.
Runtime uploads use random keys (`crypto.randomUUID()`). Idempotent migrations that must
re-derive the same key mix in the content hash (`sha256(userId + ":" + sha256(bytes))`) or HMAC
with a server-held secret.
Precedent: `docs/solutions/logic-errors/public-cdn-keys-derivable-from-exposed-ids-2026-06-10.md`.

### Bash CLI scripts calling `psql`
Only the quoted form `:'var'` is escaped by psql. A bare `:var` is substituted literally, so a
hostile value can close the predicate and rewrite the `WHERE` clause or stack a second statement
— and psql reports no error, because the resulting SQL is valid. Validate any bare-substituted
value as a strict integer or keyword enum *before* it reaches the query.
Separately, never derive a DB-name/hostname denylist from ad-hoc connection-string slicing
(`${VAR##*/}`): a trailing query string (`...?sslmode=require`) defeats the string match while
`psql` and `pg` still connect to the denied database.

**Parsing the URL is NOT the fix** — the precedent live-probed it and it still fails two ways:
libpq honours a `?dbname=nutricam` query parameter *over* the URI path segment, and
percent-encoding (`nutr%69cam`) defeats a literal match. Ask the driver for ground truth instead
and denylist *that*:

```bash
ACTUAL_DB=$(psql -X -tAqd "$URL" -c 'SELECT current_database()')   # then denylist $ACTUAL_DB
```

(TypeScript/`pg`: `client.query('SELECT current_database()')`.) Note also that `psql -c` does
**not** run the variable-substitution pass at all — only stdin, heredoc and `-f` do — so a
`-c "… :var …"` call is a silent no-op rather than an injection, and must not be mis-triaged as
either safe or exploitable without checking which channel is in use. The `scripts/pg-lab/*.sh`
family still carries this as an OPEN gap; the TypeScript copy is `server/lib/contract-snapshot.ts`
and fixing one does not fix the other.
Precedents: `docs/solutions/logic-errors/psql-c-flag-skips-var-substitution-2026-07-05.md`,
`docs/solutions/logic-errors/denylist-bypassed-by-connection-string-query-string-2026-07-06.md`.
