# Password policy: 15 characters, or 8 with two-step verification (MFA part 3) — Design

> **Superseded in part — owner ruling 2026-10-12.** After the owner was locked out by this flow, three rulings replace parts of this spec. (1) The minimum is **8 characters for everyone**, whether or not two-step is on; the breach check stays. (2) **Sign-in never stops** for a "longer password or two-step" choice, so the upgrade pass and the sign-up two-step switch are gone. (3) Two-step stays **optional only**. Where this spec says 15, read 8.

- **Date:** 2026-10-10 (rev 3, same day: rev 2 after `server-reviewer` + `security-auditor`, rev 3 after the advisor)
- **Todo:** `todos/P2-2026-09-26-password-length-policy.md` (human-led, `security`; gate overridden by the owner in-session 2026-10-10)
- **Depends on:** MFA part 1 (TOTP + recovery codes), live 2026-10-10. Spec: `docs/superpowers/specs/2026-10-10-totp-second-factor-design.md` (cited below as "TOTP spec").
- **Reviewed by:** `code-reviewer` + `security-auditor` + `server-reviewer` (+ `mobile-reviewer` for client PR parts). Never auto-merged.

## 1. Decisions

Standing rulings (todo, 2026-09-26): each account is either **password-only with ≥15 characters** or **password + second factor with ≥8**; no composition rules; max ≥64; breached-password screening; existing hashes keep verifying.

Owner, 2026-10-10:

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | **Every character counts.** Over-long passwords are never silently truncated: passwords are pre-hashed before bcrypt (§3).                                                                                                                                                                                                                                                                                                                                     |
| P2  | **Breach check fails open.** If the range API is down or slow, the password is accepted without the check.                                                                                                                                                                                                                                                                                                                                                     |
| P3  | **The Google/Apple Connect prompt follows the sign-in rule.** A correct short password there on a no-MFA account leads to the restricted pass, not a session.                                                                                                                                                                                                                                                                                                  |
| P4  | **Sign-up picks the path up front:** a "Use two-step verification" switch sets the minimum to 8 (on) or 15 (off). The switch changes the **minimum only**: it is not stored and does not by itself force setup. A switch-on account with an 8–14 password is sent to setup at first sign-in by §5.2; one that typed 15+ anyway is never prompted and can turn two-step on from Profile. Switch copy: "Use two-step verification (lets you use 8+ characters)". |
| P5  | **The restricted session is a DB-backed opaque pass** in its own table (approach A), not a JWT — the same reasoning as TOTP spec D6.                                                                                                                                                                                                                                                                                                                           |

## 2. The rule — `shared/constants/password-policy.ts`

One pure module imported by server and client (replaces the hand-synced copy in `client/screens/LoginScreen-utils.ts` and the regex in `server/routes/_schemas.ts`).

- `passwordLength(pw) = [...pw.normalize("NFC")].length` — code points after NFC (SP 800-63B-4). Never `.length`.
- `PASSWORD_MIN_SINGLE_FACTOR = 15`, `PASSWORD_MIN_WITH_MFA = 8`, `PASSWORD_MAX = 128`.
- `newPasswordProblem(pw, { min })` → `null | "too_short" | "too_long"` (the caller picks `min` from the account's state), plus `passwordMessage(problem, context)` returning one static sentence (as shipped in PR 1; PR 1 sign-up has no switch, so its message is "Use at least 15 characters."):
  - sign-up, switch off: "Use at least 15 characters, or turn on two-step verification to use 8."
  - sign-up, switch on / MFA account: "Use at least 8 characters."
  - no-MFA account (reset, disable, upgrade): "Use at least 15 characters."
  - too long: "Use at most 128 characters."
- No composition rule. The letter-and-digit regex is deleted on both sides.
- Bounds-only current-password fields (`loginSchema`, `reauthProofSchema`, `socialLinkSchema`, `changeEmailSchema`, `mfaPasswordSchema`) stay bounds-only — existing passwords must keep working. PR 1 raised their raw cap from 200 to 512 UTF-16 units (the same cap as `newPasswordSchema`): 128 code points can be 256 units of emoji, and a password the rule accepts must also work at sign-in.

Server zod: `newPasswordSchema` becomes `z.string().max(512).superRefine(...)` on the **floor** (8) and `PASSWORD_MAX`; the state-dependent 15 is checked in the route where the state is known (§4), because a schema can't see the account.

## 3. Hashing — `server/lib/password-hash.ts`

bcrypt 6.0.0 silently truncates past 72 bytes (measured 2026-10-10: a 73-char password compares true against the hash of its 72-char prefix).

- `hashPassword(pw)`: `"pv2$" + bcrypt.hash(base64(sha256(pw.normalize("NFC"))), 12)`. The base64 digest is 44 ASCII bytes — under 72, no NUL bytes.
- `passwordMatches(input, hash)` (existing chokepoint, `server/lib/password-check.ts`): `pv2$` prefix → compare the pre-hash; otherwise legacy `bcrypt.compare(input, hash)`. NULL hash keeps the dummy compare.
- Every `bcrypt.hash` of a user password (`auth.ts` register ×2, reset; `server/scripts/seed-recipes.ts`) goes through `hashPassword`. The direct `bcrypt.compare(..., DUMMY_PASSWORD_HASH)` at `auth.ts` login stays (timing only).
- **Rehash on sign-in:** only when `Buffer.byteLength(input, "utf8") <= 72` (a legacy compare proves only the first 72 bytes, so a longer input may not be the password the user actually types; those hashes stay legacy until the password changes). After a successful legacy compare, a **compare-and-swap** `UPDATE users SET password = $new WHERE id = $id AND password = $legacyHashRead` (storage `upgradePasswordHash`). 0 rows is a silent no-op: a reset, upgrade or disable-with-new-password that committed in between wins and is never overwritten with the old password. No `tokenVersion` bump; failure logged, not surfaced. Legacy hashes disappear as owners sign in.
- **One hashing facade:** a source-grep guard test fails on any `bcrypt.hash(` outside `server/lib/password-hash.ts` and `server/storage/api-keys.ts` (call-shape regex, non-vacuous walk asserting it scanned files).
- `DUMMY_PASSWORD_HASH` stays cost 12, the same cost as `pv2$` hashes; a test pins it so the unknown-user timing matches.
- **Rollback hazard:** once any `pv2$` hash exists, a server older than PR 1 can't verify it (legacy compare fails). Fix forward only; never redeploy a pre-PR-1 server.
- API-key hashing (`server/storage/api-keys.ts`) is not a password and is unchanged.

## 4. Breach check — `server/lib/pwned-password.ts`

- `isBreached(pw, fetchImpl = fetch)`: SHA-1 upper-hex of the NFC string; GET `https://api.pwnedpasswords.com/range/<first 5>` with `Add-Padding: true`, `AbortSignal.timeout(PWNED_TIMEOUT_MS = 3000)`; scan `SUFFIX:COUNT` lines, ignoring count 0.
- Returns `true | false | "unavailable"`. `"unavailable"` (timeout, non-200, network) is accepted (P2) and logged at `warn` with no password material.
- Only the 5-hex prefix ever leaves the server; never the password or full hash; never logged.
- Runs on every **new** password (register, reset, disable-with-new-password, upgrade set-password), after zod and after any code/proof check, before hashing. Breached → `400 PASSWORD_BREACHED` ("That password has appeared in a data breach. Choose a different one.").
- Register: the breach check runs **before** the email/username existence check, on every branch, so neither its answer nor its latency depends on whether the account exists. A breached password returns `400 PASSWORD_BREACHED` like any validation error.

## 5. Where the rule applies

### 5.1 Sign-up (`POST /api/auth/register`)

Body gains `twoStep: boolean` (default false). Minimum = 8 if `twoStep`, else 15 → `400 PASSWORD_TOO_SHORT` (client shows §2 copy). `twoStep` is **not stored**: sign-in decides from length + MFA state (§5.2). The verification-off branch, which issues a token directly, must not issue a full token for a password under 15 — it returns the restricted pass instead (§6).

**PR staging:** PR 1 ships register with min 15 and no switch; the switch (8) ships in PR 2 with the pass, so no window exists where an 8-character password-only account can get a session.

### 5.2 Sign-in (`POST /api/auth/login`) and Connect (`/api/auth/social/link`, password branch)

After the password check and `EMAIL_NOT_VERIFIED`: if the account has MFA → unchanged (challenge / trusted phone). Else if `passwordLength(input) < 15` → create an upgrade pass and respond `200 { status: "upgrade_required", pass, canUseTwoStep }`. **No token.** `canUseTwoStep = passwordLength(input) >= 8`: below 8 (only legacy/dev accounts, e.g. the dev DB's `demo` account), turning two-step on would still leave the password under the 8 floor, so only "Choose a longer password" is offered (the server's upgrade TOTP routes also refuse a pass whose sign-in password was under 8 — the pass row stores `two_step_allowed`).

**Connect (P3) gates BEFORE linking.** TOTP spec D1 lets a linked Google/Apple identity sign in with no second factor, so linking first and gating second would let whoever guessed the short password link their own provider account and walk around the pass. On the Connect password branch, a no-MFA account with a password under 15 gets `upgrade_required` and the identity is **not** linked. After the account is compliant, the user taps the provider again (the pending ticket may have expired); the link then goes through the normal Connect flow.

### 5.3 Password reset (`POST /api/auth/reset-password`)

zod checks only floor + max (unchanged shape, account-independent — reset spec §4.2). **After** `resetCodeMatches`, before hashing: minimum = 8 if `mfaEnabledAt` (add it to `reservePasswordResetAttempt`'s `RETURNING`) else 15 → `400 PASSWORD_TOO_SHORT`. The attempt already counted; the code is **not consumed**, so the user can retry within the attempt cap. A wrong code with a too-short password returns the invalid-code 400, never `PASSWORD_TOO_SHORT` (no MFA-state leak without a valid code). `mfaEnabledAt` goes in both the `RETURNING` clause and the function's return type. Then breach check (same not-consumed rule for `PASSWORD_BREACHED`), then `completePasswordReset` (unchanged: bumps `tokenVersion`, deletes trusted phones, MFA stays on — TOTP spec D7).

### 5.4 Turning two-step off (`POST /api/auth/mfa/disable`)

Body gains optional `newPassword`. **After the current-password check and before `requireFactor`** (amended by the PR 1 plan, so a policy rejection never spends a recovery code; the caller has already proven the password, so the answer reveals nothing): if `passwordLength(body.password) < 15` and no `newPassword` → `400 PASSWORD_UPGRADE_NEEDED` ("Your password is shorter than 15 characters. Choose a new one of at least 15 to turn off two-step verification."). `newPassword` has its own zod field (floor 8 + max, same as §2); the 15 is checked in the route. If given: policy (15) + breach check, then `disableMfa(userId, { newPasswordHash })` writes the hash in the same transaction as the existing deletes and `tokenVersion` bump, **and clears `pending_email`** (as `completePasswordReset` does), so a staged change-email can't survive a credential change. Cache invalidation runs after commit. Notice email says the password changed too.

Client: TwoStepSetupScreen "disable" mode handles `PASSWORD_UPGRADE_NEEDED` by showing a new-password field (+ confirm) and resubmitting.

### 5.5 Manual lost-phone reset (`scripts/mfa-reset.ts`)

Unchanged: it has no password in hand. The account's next password sign-in hits §5.2 if its password is under 15.

### 5.6 Adding a password to a Google/Apple-only account

No such route exists today (the todo's criterion has nothing to apply to). Out of scope; any future route imports the §2 policy and the §5.4 state-dependent minimum.

### 5.7 Dev and test accounts

The seed script's default demo password is a random 24-character string (`server/scripts/seed-recipes.ts:218`), which passes. But the dev DB's existing `demo` account uses `demo123` (`.claude/skills/verify-ui/SKILL.md:35`), which after PR 2 hits the pass with only "Choose a longer password". Before PR 2 merges: reset the dev `demo` password to a 15+ value, update `verify-ui/SKILL.md` and the test-account memory.

## 6. The upgrade pass (PR 2)

**Migration `migrations/0020_password_upgrade_passes.sql`** (hand-written, applied to prod before merge, as 0017–0019; 0019 is `recipe_tries`) + `shared/schema.ts`:

> **Amended by the PR 2 plan (rulings R1–R7):** migration number 0020; dead passes are also swept per user whenever a new pass is minted (the retention job is prod-gated off until ≥2026-11-03); `/upgrade/password` does not reserve a pass attempt (a policy rejection is not a guess); TOTP confirm consumes the pass inside `confirmTotpEnrollment`'s transaction, guarded on the pass's `tokenVersion`; the app holds the confirm session until the recovery codes are saved; a `two_step_allowed=false` pass gets `403 UPGRADE_TWO_STEP_NOT_ALLOWED` on the TOTP routes; turning two-step on through the pass sends the `enabled_at_sign_in` notice. Under 8 at sign-up stays a schema `VALIDATION_ERROR` (PR 1 behaviour).

`password_upgrade_passes`: `id_hash` PK (SHA-256 of `"pw-upgrade:" + 32-byte random token`), `user_id` (FK cascade), `token_version`, `attempts` int default 0, `two_step_allowed` boolean, `expires_at` (now + 30 min), `consumed_at` nullable, `created_at`. Named indexes on `user_id` and `expires_at`. Cleanup in `server/scripts/cleanup-retention.ts`: delete rows expired or consumed more than a day ago, under the existing retention flag.

**Middleware `requireUpgradePass`** (`server/middleware/upgrade-pass.ts`): reads `Authorization: UpgradePass <token>`; row must exist, be unconsumed, unexpired, the user row must exist, `token_version = user.tokenVersion`, and the user must still have no MFA. Sets `req.userId` for the handlers. It is a different scheme and never a JWT, so `requireAuth` cannot accept it and it cannot reach any `requireAuth` route.

**Shared TOTP logic:** `stageSecret` and the confirm-enrollment block move from `server/routes/auth-mfa.ts` into `server/services/mfa-totp.ts`, taking an already-verified user. `/mfa/totp/*` and `/upgrade/totp/*` both call it. The routes keep the `MFA_SETUP_ENABLED` gate, their own auth (`requireAuth` vs `requireUpgradePass`), and session issue.

**Attempts and consumption are atomic:** before verifying a code, reserve an attempt with `UPDATE … SET attempts = attempts + 1 WHERE id_hash = $1 AND consumed_at IS NULL AND expires_at > now() AND attempts < 10 RETURNING …` (no row ⇒ `401 UPGRADE_PASS_EXPIRED`). Success consumes it with a conditional `UPDATE … WHERE consumed_at IS NULL RETURNING`, so a double submit can't mint two sessions or two sets of recovery codes. Signing in again mints a fresh pass, so the effective bound on guessing is the login limiter × 10 per pass; the routes also use an IP-keyed limiter (pre-auth: no `userId` for a `keyGenerator`).

**Routes** (`server/routes/auth-upgrade.ts`), all `requireUpgradePass` + rate-limited:

- `POST /api/auth/upgrade/totp/setup` → stage a secret; **no body password** (the pass is the proof). `403` if the pass's `two_step_allowed` is false; `403 MFA_SETUP_DISABLED` when `MFA_SETUP_ENABLED` is off.
- `POST /api/auth/upgrade/totp/confirm` → same as `/mfa/totp/confirm`; each failure increments `attempts` on the pass (cap 10 → pass dead). On success: recovery codes returned, pass consumed, notice email that also says how to recover if it wasn't them (an email reset leaves two-step on — TOTP spec D7 — so recovery is the support runbook), `tokenVersion` bump + cache invalidation, `issueSession`.
- `POST /api/auth/upgrade/password { newPassword }` → policy 15 + breach check; in one transaction: write hash, consume pass, bump `tokenVersion`, delete trusted phones, clear `pending_email`; then cache invalidation, `sendPasswordChangedNotice`, `issueSession`.

**Client:** new root-stack screen `PasswordUpgradeScreen` (pre-auth) with two choices: "Turn on two-step verification" (listed first; hidden when `canUseTwoStep` is false or setup returns `MFA_SETUP_DISABLED`) and "Choose a longer password". `useAuth.login` and the Connect flow route `upgrade_required` there. The pass lives in memory only (never Keychain).

- **Shared setup steps:** the add-key → enter-code → save-codes UI moves out of `TwoStepSetupScreen` into a component parameterised by its API calls (`stage`, `confirm`), so `TwoStepSetupScreen` passes the `requireAuth` calls and `PasswordUpgradeScreen` passes the upgrade calls. The save-codes step keeps the #1364 leave guard (`usePreventRemove` + `shouldGuardLeave`) in both hosts.
- **Upgrade requests** send `Authorization: UpgradePass <pass>` through a dedicated request helper, never the stored Bearer token.
- LoginScreen sign-up gets the switch (P4) with live hint copy.

## 7. iOS password hints and the "14"

Our code never enforced 14 (searched `main` 2026-09-26 and 2026-10-10). The sign-up password fields set no `textContentType`/`autoComplete`, so iOS may have offered a generated password. Sign-up and reset password fields get `textContentType="newPassword"` and `autoComplete="new-password"`. `passwordRules` tracks the active minimum: sign-up `minlength: 15; maxlength: 128;` (PR 1, and switch off), `minlength: 8; maxlength: 128;` with the switch on; reset uses the floor (8), since the account's MFA state isn't known client-side. Closing criterion: "not app code", with this evidence.

## 8. Error codes (`shared/constants/error-codes.ts`)

`PASSWORD_TOO_SHORT`, `PASSWORD_UPGRADE_NEEDED`, `PASSWORD_BREACHED`, `UPGRADE_PASS_EXPIRED`, `UPGRADE_TWO_STEP_NOT_ALLOWED` (added by the PR 2 plan, R2). The client shows static copy per code (the server message is never displayed).

## 9. Delivery

- **PR 1 (OTA):** §2, §3, §4, §5.1 (min 15, no switch, copy names only the 15 rule), §5.3, §5.4, §7, error codes. Client: the shared-module mirror, static copy for `PASSWORD_TOO_SHORT` / `PASSWORD_BREACHED` on **both** register (today `getAuthErrorMessage` collapses register errors to "Registration failed.") and reset, and the disable-mode new-password field shown on `PASSWORD_UPGRADE_NEEDED` (so no OTA client hits a dead end).
- **PR 2 (migration first, then OTA):** §6, §5.1 switch, §5.2.
- Until PR 2 ships, an existing short password still signs in fully. Accepted: per the owner (2026-10-06) the app has no users besides the owner, whose account has two-step on (device test 2026-10-10) — re-check before merging PR 1 by counting prod users with `mfa_enabled_at IS NULL` (owner runs it via `!`).

## 10. Tests

- Policy: code-point and NFC boundaries (14/15, 7/8, 128/129, an emoji counts as 1, a decomposed "é" equals the composed one), identical results imported from client and server.
- Hashing: pv2 round-trip; rehash CAS loses to a concurrent reset (old password not restored); a legacy >72-byte input is not rehashed; facade grep guard; dummy-hash cost pinned; a >72-byte password differing only after byte 72 does **not** match; legacy hash still verifies and is rehashed to pv2 on sign-in.
- Breach: only `/range/<5 hex>` is requested (assert URL); breached → 400; timeout/500 → accepted.
- Reset: 10 chars on a no-MFA account → 400 after a correct code, code still usable; 10 chars on an MFA account → OK; no account-state leak before the code check.
- Disable: short current password without `newPassword` → 400; with a 15+ `newPassword` → MFA off and password changed in one transaction.
- Disable / upgrade password: `pending_email` cleared.
- PR 2: concurrent confirms can't pass the 10 cap or mint two sessions; login under 15 / no MFA → `upgrade_required`, no token; the pass gets 401 from an ordinary `requireAuth` endpoint (real middleware, `test/integration/auth-routes.itest.ts`); a JWT gets 401 from upgrade routes; pass expiry, `tokenVersion` change, 10-attempt cap; Connect with a short password on a no-MFA account returns `upgrade_required` and links nothing; a pass from a <8 password gets 403 on the upgrade TOTP routes; sign-up switch on/off minimums.
