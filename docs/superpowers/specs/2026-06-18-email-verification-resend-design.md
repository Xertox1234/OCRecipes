# Email Verification via Resend — Design

- **Date:** 2026-06-18
- **Todo:** `todos/P2-2026-06-18-email-verification-resend.md`
- **Prerequisite (merged):** `P2-2026-06-18-signup-email-field.md` → PR #400 (added `email` + `emailVerified` columns)
- **Status:** design approved; ready for implementation plan
- **Author:** brainstorm session, 2026-06-18

> This spec lives under `docs/superpowers/specs/` which is **gitignored / local-only**.
> It is planning scratch; the implementation plan and code are the committed artifacts.

---

## 1. Goal

Verify the email address collected at signup, as a security measure, using
[Resend](https://resend.com). The `users` table already carries
`email text NOT NULL UNIQUE` and `emailVerified boolean default false NOT NULL`
(`shared/schema.ts:34-35`, from PR #400), so **this feature needs no new DDL** —
it only reads/writes the existing `emailVerified` column plus a one-time data
backfill.

## 2. Decisions (the five open questions, resolved)

| #   | Question                       | Decision                                                                                                                                                              |
| --- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Gating policy**              | **Hard gate** — block login until verified. Fails **open** whenever email sending isn't configured.                                                                   |
| 2   | **Token strategy**             | **Stateless signed JWT**, partitioned from access tokens by a distinct audience + `purpose: "email-verify"` claim, **24h TTL** (default). No new table, no migration. |
| 3   | **Deep-link UX**               | **`https://ocrecipes.app/verify-email?token=…` universal link** as primary (custom scheme is unreliable in email clients).                                            |
| 4   | **Resend-verification flow**   | A `POST /api/auth/resend-verification` endpoint with its own **per-recipient-email** rate limit; always returns a neutral 200.                                        |
| 5   | **Anti-enumeration at signup** | On duplicate-email signup, return the **same neutral "check your inbox"** response and background-notify the real owner.                                              |

### Why stateless (not a DB token table)

A verification link does exactly one harmless thing — flips `emailVerified` — and
does **not** grant account access (that still requires username + password). So the
DB table's main advantage, revocation, buys almost nothing here. Stateless keeps the
todo's headline property (**no new prod DDL → no Railway migrate-before-merge
hazard**) and is self-neutralizing: once `emailVerified` is true, replaying any old
link is an idempotent "already verified" no-op. A DB token table is the right call
later for **password reset**, where a link _does_ grant access and revocation matters.

## 3. Scope boundaries

**In scope:** verification-token issue at signup, verify endpoint, resend endpoint,
the hard gate (with fail-open), signup anti-enumeration, the Resend integration,
and a one-time backfill of existing accounts.

**Deliberately OUT of scope (boundaries, not oversights):**

- **Email-change re-verification.** This is the one place the server-side check
  genuinely earns its keep, and it complicates the gate logic. Separate follow-up todo.
- **Password reset / magic-link login.** The feature that would justify a DB token
  table. Introduce the table then, for the feature that needs revocation.

## 4. Components — each a single, testable unit

| Unit                                         | Purpose                                                                                                                                                                                                         | Depends on                           |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `server/services/email.ts` (new)             | Resend wrapper: `sendVerificationEmail`, `sendSignupAttemptNotice`. **No-ops when `RESEND_API_KEY` is absent.** All sends fire-and-forget.                                                                      | `resend` SDK, env                    |
| `server/lib/verification-token.ts` (new)     | `signVerificationToken(userId, email)` / `verifyVerificationToken(token)`. Partitioned from access tokens by a **distinct audience + `purpose: "email-verify"` claim**, 24h TTL.                                | `jsonwebtoken`, `JWT_SECRET`         |
| `server/routes/auth.ts` (edit)               | register-flow change, login gate, `POST /verify-email`, `POST /resend-verification`                                                                                                                             | the two units above                  |
| `server/routes/_rate-limiters.ts` (edit)     | `resendVerificationLimiter` + `signupNoticeLimiter` (**keyed per-recipient-email**, not just IP) + `verifyEmailLimiter` (IP-keyed; guards the unauthenticated verify endpoint — JWT-verify + DB write per call) | existing `createRateLimiter` factory |
| `server/middleware/auth.ts` (edit)           | mint access tokens with an `emailVerified` claim (data only — `requireAuth` does not gate on it)                                                                                                                | existing `generateToken`             |
| `client/screens/VerifyEmailScreen.tsx` (new) | "check your inbox" + deep-link token handling + resend button                                                                                                                                                   | nav                                  |
| `client/navigation/linking.ts` (edit)        | add `verify-email` path → `VerifyEmailScreen`                                                                                                                                                                   | existing linking                     |
| client signup/login flows (edit)             | route signup → "check your inbox"; handle login `403 EMAIL_NOT_VERIFIED`                                                                                                                                        | AuthContext                          |

## 5. The hard gate — two layers + fail-open

**The login block IS the gate. There is NO runtime `requireAuth` claim-check.**
Rationale: once login _and_ register only ever mint a token for a verified user,
possessing a valid access token already proves verification, so a runtime check adds
no security. Worse, a `requireAuth` reject on `emailVerified === false` would actively
**strand** any user whose token was minted during the gate-OFF rollout window: their
DB row is grandfathered by the backfill, but the in-flight 7-day token still carries
the stale `false` claim and cannot be reissued server-side. We therefore do **not**
extend the deliberately DB-free auth-cache hot path (flagged fragile in the
`project_auth_recurring_breakage` notes) with any verification check.

- **Layer 1 (the only gate):** login with valid-but-unverified creds → `403
EMAIL_NOT_VERIFIED`, **no token**. Register → "check your inbox", **no token**.
  Unverified users never hold a token (when the gate is ON). `EMAIL_NOT_VERIFIED`
  therefore originates only from `POST /login` — handled by `LoginScreen` — never from
  an arbitrary authenticated request, so no global-interceptor handling is needed.
- **Token claim (data only, no runtime guard):** new access tokens carry an
  `emailVerified` claim, but **`requireAuth` never reads it.** The claim is cheap
  belt-and-suspenders carried for a _future_ token path (e.g. refresh tokens / OAuth)
  that might mint a token outside the login gate; that path would own its own check.
  Protection for tokens minted _before_ (or during the OFF window of) this change rests
  **entirely on the one-time backfill (§9)** — there is no runtime guard to strand them.
  _(Execution note: a `requireAuth` reject-on-`false` check was implemented in Task 4
  and removed before merge once the rollout-window stranding was traced in an advisor
  pass. The backfill is what carries grandfathering.)_
- **Fail-open:** a single `emailVerificationEnabled()` predicate (true only when
  `RESEND_API_KEY` is set). When **false**, the gate is off _everywhere_ — login issues
  tokens normally. This is what keeps local dev, `demo/demo123`, and prod-before-DNS
  all working instead of bricked.

## 6. Data flow (the paths)

```
Signup, new email   → create user(emailVerified=false) → NO token
                      → fire-and-forget sendVerificationEmail → 200 "check your inbox"
Signup, existing + UNVERIFIED email
                    → NO new account; DO NOT touch the existing password
                      → fire-and-forget (RE)send the verification email to that address
                      → byte-identical 200 "check your inbox"
Signup, existing + VERIFIED email
                    → NO new account
                      → fire-and-forget sendSignupAttemptNotice ("someone tried…") to owner
                      → byte-identical 200 "check your inbox"
                    (both existing branches: per-recipient rate-limited;
                     identical neutral 200 in all three signup cases → no oracle)
Verify              → tap https://ocrecipes.app/verify-email?token=… → VerifyEmailScreen
                      → POST /api/auth/verify-email {token} → check sig/exp/purpose/audience
                      → markEmailVerified(userId) (idempotent) → route to login
Login, verified     → 200 { user, token(emailVerified claim) }
Login, unverified   → sending ON:  403 EMAIL_NOT_VERIFIED, no token → VerifyEmailScreen
                    → sending OFF: normal token (fail-open; never locks dev/demo)
Resend              → POST /api/auth/resend-verification {email} → ALWAYS neutral 200
                      → if exists & unverified: fire-and-forget send (per-email rate limit)
```

### 6a. Check ordering (don't wire the branches wrong)

The register handler checks **username uniqueness _before_ email**
(`server/routes/auth.ts:79-99`), and the username path keeps its existing
`409 "Username already exists"` (the accepted residual in §7). Consequences for the
re-registration flow:

- **Same username + same email** → hits the `409` username check _first_; never reaches the
  email branch. Not a trap: the user learns they have an account, attempts login, gets
  `403 EMAIL_NOT_VERIFIED`, and recovers via the verify screen's **resend** button.
- **Different username + existing email** → passes the username check, reaches the email
  branch → the existing-unverified vs existing-verified logic (§6) applies. The supplied
  username is **not** used (no account is created); only the existing account's address is
  (re)mailed.

So an unverified user has **two** recovery paths (login→403→resend, _and_ the re-register
resend branch), and the email-branch logic is only load-bearing for the
different-username-same-email case. Implement the checks in this order; do not reorder them.

## 7. Anti-enumeration — the three holes, closed

The hard gate makes a _successful_ signup return a content-free "check your inbox"
(no user object, no token), so **every** signup response — new email,
existing-unverified, existing-verified — is **byte-for-byte identical**. The server
branches _internally_ on the existing account's state (§6): existing-**unverified** →
(re)send the verification email (never the alarm), so a user retrying a spam-foldered
signup is **converted, not trapped**, and the existing password is **left untouched**
(updating credentials on an unauthenticated request is an account-takeover shape);
existing-**verified** → send the "someone tried…" notice. The registrant cannot
distinguish the three cases. The three subtle holes that remain:

- **Timing oracle** → two equalizations keep the duplicate-email and new-email paths
  returning in the same wall-clock: (1) every email send is **fire-and-forget background
  work** (a synchronous notice/verification send on the dup path would re-open the oracle
  via latency), and (2) the new-account path's `bcrypt.hash` (~250ms — the dominant cost)
  is paid on the existing-email branch too when verification is ON, by hashing **before**
  the email-existence lookup. Without (2) the dup path (which never creates, so never
  hashed) would return ~250ms faster than the new-account path, leaking email existence
  despite the byte-identical 200 body. The OFF path skips the pre-hash (its `409` is not
  anti-enumerating). Accepted residual: the `createUser` insert (~few ms) on the new path
  is not equalized.
- **Email-bomb amplifier** → the owner-notice and resend paths get a
  **per-recipient-email cap**, because `registerLimiter` (5/hr/IP) is IP-rotatable and
  would not stop a victim's inbox being flooded.
- **Stated residual limit:** username-taken still returns `409 "Username already exists"`
  (pre-existing; usernames are semi-public; out of scope for this todo).

Login's `403 EMAIL_NOT_VERIFIED` is **not** a new enumeration oracle: it is only
reachable _after_ correct username + password, so the prober already holds valid creds.

## 8. Token partitioning (security detail)

The access-token verifier (`server/middleware/auth.ts:108-116`) enforces
`issuer` + `audience` and `isAccessTokenPayload(payload)`. The verification token is
signed with the **same `JWT_SECRET`** but a **distinct `audience`** (e.g.
`ocrecipes-email-verify`) and a `purpose: "email-verify"` claim, and carries no
`tokenVersion`. Consequences:

- A verification token presented as a Bearer access token **fails** `requireAuth`
  (wrong audience / not an access-token payload).
- An access token presented to `/verify-email` **fails** `verifyVerificationToken`
  (wrong audience / missing `purpose`).
- The two token classes are cryptographically partitioned despite sharing the secret.
- **`/verify-email` issues NO access token.** Verifying proves _email ownership_, not
  _password possession_ — anyone who obtains the link (forwarded mail, shared inbox) must
  not thereby be logged in. On success the client routes to **login**. Minting a session
  token on verify success ("save the user a step") is an **auth bypass** — explicitly do
  not do it.

## 9. Config, ops & safe sequencing

- **Env:** `RESEND_API_KEY`, `EMAIL_FROM` — secrets, **no `EXPO_PUBLIC_` prefix**;
  documented in `docs/DEV_SETUP.md`.
- **Backfill (no DDL):** a one-time `UPDATE users SET email_verified = true` for
  pre-existing rows at deploy + add `emailVerified: true` to the demo seed
  (`server/scripts/seed-recipes.ts:241`). This is a _data_ update, not a schema change —
  no Railway migrate-before-merge hazard.
- **Sequencing for a safe landing:**
  1. Ship token + endpoints + email service + fail-open + backfill **first**. The gate
     is effectively off because the prod `RESEND_API_KEY` / domain isn't live yet.
  2. Configure Resend; verify the sending domain's **SPF / DKIM / DMARC**.
  3. **Re-run the backfill `UPDATE` immediately before flipping** — it is a point-in-time
     snapshot, and any user who registered during the gate-off window (steps 1→2) would
     otherwise be unverified and locked out the instant the gate turns on. Then flip the
     gate **on** (set the prod key).
- **Accepted cost once the gate is on:** login availability couples to Resend uptime;
  a failed send or Resend outage strands new users until a resend succeeds — so the
  resend escape hatch must be solid.

## 10. Error handling

- `/verify-email`: invalid / expired / wrong-purpose / wrong-audience / tampered token
  → `400` with a clear code; already-verified → `200` idempotent. Rate-limited by
  `verifyEmailLimiter` → `429` when exceeded. Success returns **no access token** (§8).
- Email send failure → logged, **not** surfaced to the user on signup (fire-and-forget);
  the resend path returns neutral `200` regardless.
- The `emailVerificationEnabled()` fail-open guard prevents lockout when sending is
  misconfigured.

## 11. Testing

- **Token:** valid / expired / wrong-purpose / wrong-audience / tampered.
- **Register:** new / existing-unverified / existing-verified → **identical** neutral 200;
  existing-unverified → verification email **re-sent** (mock) and the **password is left
  unchanged**; existing-verified → owner-notice fired (mock); **no account created** on
  either existing case.
- **Login:** verified → token (with claim); unverified + sending-on → 403; unverified +
  sending-off → token (fail-open).
- **Verify endpoint:** valid / expired / already-verified; success returns **no token**;
  rate limit (`verifyEmailLimiter`) → 429.
- **Resend:** neutral 200; per-email rate limit enforced.
- **Email service:** no-op when `RESEND_API_KEY` absent.
- **`requireAuth`:** does NOT read `emailVerified` — no verification gate at the
  middleware layer (see Layer 1 / "no runtime claim-check" above). Token-version and
  DB-load behavior unchanged.
- **Deep-link routing:** `verify-email?token=…` → `VerifyEmailScreen`.
- Prefer **real-module / integration coverage** for auth paths (per the
  auth-recurring-breakage history; route tests that mock the middleware miss wiring gaps).

## 12. Risks

- **Deliverability** (SPF/DKIM/DMARC misconfig → spam). Mitigated by infra-first
  sequencing: the gate is off until the domain verifies.
- **Auth fragility.** Narrow, well-tested changes; real-module coverage; no auth-cache
  surgery.
- **Token security.** Short TTL; purpose+audience partitioning; signed, not guessable.
- **Abuse / email-bomb.** Per-recipient rate limits on notice + resend.
- **Gate-on availability coupling** to Resend uptime (see §9).
- **No lockout recourse (known gap).** With the gate on, a verification email _and_ all its
  resends landing in spam = a permanently locked-out user with no self-serve recovery. An
  admin/support verify-override is a sensible **out-of-scope follow-up** — flagged here so
  it is a known gap, not a surprise.
- **Re-registration credential safety.** A re-registration of an existing _unverified_ email
  arrives with a new password; the server **must not** apply it (a silent credential update
  on an unauthenticated request is an account-takeover shape). Resend verification only;
  leave the original password (§6, §7).

## 13. Constraints carried from project rules

- **Auth/security = NEVER-delegate.** Implement directly — not via a todo-executor or
  cheap worker.
- This is a hand-implemented change (not a `/todo` executor run), consistent with the
  todo's own note.
