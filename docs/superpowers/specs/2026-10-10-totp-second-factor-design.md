# Second factor, part 1: authenticator app (TOTP) + recovery codes — Design

- **Date:** 2026-10-10 (rev 2, same day, after spec review)
- **Todo:** `todos/P2-2026-09-26-add-second-factor-authentication.md` (part 1 of 3)
- **Supersedes:** `docs/superpowers/plans/2026-10-05-totp-second-factor.md`, which was written under the old "2FA before every session, Google/Apple included" ruling. Carried over from it: a dedicated `MFA_SECRET_ENC_KEY`, unkeyed SHA-256 for recovery codes and challenges, challenges bound to `tokenVersion`, TOTP written in-house on `node:crypto` against the RFC 6238 test vectors, and real-DB tests via `test/db-test-utils`. Its `beginSession` gate (everything goes through the challenge) is **not** carried over: D1 narrows the gate to password proofs.
- **Out of scope (own specs later):** passkeys (part 2: needs a native build, plus Cloudflare Bot Fight Mode vs the AASA/assetlinks fetchers, see the todo), the 8-character password path (part 3, `todos/P2-2026-09-26-password-length-policy.md`, depends on this).
- **Human-led, `security`-labelled:** implemented in-session, never delegated to `/todo`. Reviewed by `code-reviewer` + `security-auditor` + `server-reviewer` + `mobile-reviewer`. Never auto-merged.

## 1. Decisions (owner, 2026-10-10)

| #   | Decision                                                                                                                                                                                                                                                                |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Our second factor guards PASSWORD proofs only.** Proof from a Google/Apple identity already connected to the account never needs it. The provider's own 2FA covers that path. Supersedes the 2026-09-26 "required after social sign-in" ruling.                       |
| D2  | **The password-proof rule:** on an MFA account, every place that accepts the password as proof of identity also requires a TOTP or recovery code. That covers sign-in, the Connect prompt, connecting a sign-in method, deleting the account and changing email (§3.3). |
| D3  | Scope is TOTP, recovery codes and trusted phones. Passkeys and the 8-character path are separate specs.                                                                                                                                                                 |
| D4  | The code is asked on every password sign-in **unless the phone is trusted for 90 days**.                                                                                                                                                                                |
| D5  | **Trust survives sign-out.** It ends only on expiry, a password reset, turning MFA off, setting up a new phone, or "Forget trusted phones".                                                                                                                             |
| D6  | The "password OK, code pending" state is a **DB-backed opaque challenge**, never a JWT (§10).                                                                                                                                                                           |
| D7  | **Password reset is unchanged.** It never issues a session, so a mailbox-only attacker still hits the challenge at sign-in. A reset leaves MFA on, kills pending challenges (via `tokenVersion`) and deletes trusted phones.                                            |

## 2. Data model

**Migration `migrations/0018_totp_second_factor.sql`**, hand-written like `0017_sign_in_with_apple.sql`, plus a matching `shared/schema.ts` change. It is **applied to prod before merge** (same procedure as 0017). Every table cascades on delete from `users`.

**`user_totp`**: `user_id` PK.

- `secret_enc`: base32 secret encrypted (AES-256-GCM) with **`MFA_SECRET_ENC_KEY`**, a new 32-byte env var independent of `JWT_SECRET` and `IDENTITY_TOKEN_ENC_KEY`. It is never logged and never returned after setup.
- `pending_secret_enc` (nullable): a secret being set up (first setup or new phone). It's promoted to `secret_enc` on confirm.
- `confirmed_at` (nullable). **"Has MFA" means a row with `confirmed_at IS NOT NULL`.**
- `last_used_step` (bigint, nullable), `failed_attempts` (int, default 0), `locked_until` (timestamptz, nullable).

**`mfa_recovery_codes`**: `id`, `user_id`, `code_hash`, `used_at` (nullable), `created_at`. `UNIQUE (user_id, code_hash)`, index on `user_id`.

**`mfa_challenges`**

- `id_hash` PK: SHA-256 of a 32-byte random token; the client holds only the raw token.
- `user_id`, `token_version` (the user's `tokenVersion` at issue), `purpose` (CHECK `purpose IN ('login','link')`), `pending_social_id` (nullable FK to `pending_social_sign_ins` with cascade). A CHECK enforces `(purpose = 'link') = (pending_social_id IS NOT NULL)`.
- `attempts` (int, default 0), `expires_at`, `consumed_at` (nullable). Indexes on `user_id` and `expires_at`.

**`trusted_devices`**: `id`, `user_id`, `key_hash` (SHA-256 of a 32-byte random key, unique), `expires_at` (now + 90 days), `created_at`. There is **no `token_version`** (D5). Indexes on `user_id` and `expires_at`.

**Hashing.** Recovery codes, challenge tokens and trust keys are all at least 80 bits of random, so **unkeyed SHA-256** is enough. A database leak can't brute-force them, and no secret rotation ever voids them. Recovery codes hash `"mfa-recovery:" + userId + ":" + normalized`. Challenges use `"mfa-challenge:" + token`, and trust keys use `"mfa-trust:" + key`.

**Cleanup.** New work in `server/scripts/cleanup-retention.ts`, with tests: batch-delete `mfa_challenges` and `trusted_devices` past `expires_at`.

## 3. Flows

### 3.1 Password sign-in: `POST /api/auth/login`

The request gains an optional `trustKey`. Steps 1–2 are unchanged.

1. Password check (dummy bcrypt for an unknown user, same 401).
2. `EMAIL_NOT_VERIFIED` check.
3. No MFA: issue the token (response unchanged).
4. MFA, and `trustKey` hashes to a `trusted_devices` row for **this user** with `expires_at > now()`: issue the token.
5. Otherwise: insert a `login` challenge (5 minutes), respond `200 { status: "mfa_required", challenge }`. **No token.**

### 3.2 `POST /api/auth/mfa/verify`

Body: `{ challenge, secondFactor: { code } | { recoveryCode }, trustDevice? }`. `trustDevice` only applies to `login`.

1. **Reserve an attempt:** `UPDATE mfa_challenges SET attempts = attempts + 1 WHERE id_hash = $1 AND consumed_at IS NULL AND expires_at > now() AND attempts < 5 RETURNING *`. If no row, or the row's `token_version ≠ user.tokenVersion`, return `401 MFA_CHALLENGE_EXPIRED`.
2. If `locked_until > now()`, return the generic failure without checking the code.
3. Check the second factor (§4.2, §4.3). On failure, run the lockout `UPDATE` (§6) and return the generic failure.
4. **Consume:** `UPDATE … SET consumed_at = now() WHERE id_hash = $1 AND consumed_at IS NULL RETURNING`. If the race is lost, return the generic failure. Reset `failed_attempts`.
5. Finish the purpose. `login`: issue the token, plus a `trustKey` (returned once) if `trustDevice` is set. `link`: run `completeLinkFromTicket` on the pending row, then issue the session.

The generic failure is `401 INVALID_SECOND_FACTOR` ("That code didn't work.").

### 3.3 Password proofs on an MFA account (D1/D2)

**Rule:** where an endpoint accepts a password as proof and the account has MFA, the request must also carry a valid `secondFactor`. Where the proof is an already-connected Google/Apple identity, it doesn't. Sweep of every password-proof site, checked 2026-10-10 by grepping `passwordMatches(` and `reauthenticate(`:

| Endpoint                                                             | Proof today                        | Under MFA                                                                                                                                                                               |
| -------------------------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/auth/login` (`auth.ts:335`)                               | password                           | challenge (§3.1)                                                                                                                                                                        |
| `POST /api/auth/social/link`, password branch (`auth-social.ts:561`) | password                           | correct password: insert a `link` challenge (`expires_at` capped at the pending row's) and respond `mfa_required`. **Don't** call `completeLinkFromTicket`; verify (§3.2) completes it. |
| `POST /api/auth/social/link`, provider branch                        | already-connected identity         | unchanged, no code (D1)                                                                                                                                                                 |
| `POST /api/auth/identities` (`auth-social.ts:654`, `reauthenticate`) | password **or** connected identity | password proof: also needs `secondFactor` inline. Identity proof: unchanged                                                                                                             |
| `DELETE /api/auth/account` (`auth.ts:802`, `reauthenticate`)         | password **or** connected identity | same as above                                                                                                                                                                           |
| `POST /api/auth/change-email` (`auth.ts:618`)                        | password                           | needs `secondFactor` inline                                                                                                                                                             |

**Inline form** (signed-in routes): check the password first. If it's correct, the account has MFA, and no `secondFactor` was sent, return `403 SECOND_FACTOR_REQUIRED`. That error code already exists and the client already handles it, so it now means "ask for the code and resend". This only appears after a correct password, so it leaks nothing to someone without it. A wrong factor runs the lockout `UPDATE` and returns the route's existing generic 401. The check goes in **one helper**, `requireSecondFactorForPasswordProof(user, proof, secondFactor)` in `server/lib/mfa/`, called by every row above, so a future password-proof route has one place to wire in.

**Google/Apple sign-in itself:** the `requiresSecondFactor` stub and the second-factor branch of `signInGate` (`server/lib/social-identity/sign-in-gates.ts`) encode the superseded 9/26 ruling, so they are **removed**. `signInGate` keeps only the email-verification check. So an already-connected sign-in (`auth-social.ts:387`) goes straight in. **`decideLink`'s `hasSecondFactor`** is fed by the real "has MFA" query, so an MFA account never auto-links. It always gets the Connect prompt, as in the table above.

### 3.4 Password reset (D7)

`/api/auth/forgot-password` and `/api/auth/reset-password` keep their current request and response shapes. The reset's existing atomic update (password, `tokenVersion + 1`, code cleared) gains one statement **in the same transaction**: delete this user's `trusted_devices`. The `tokenVersion` bump already kills pending challenges (§3.2 step 1). MFA stays on. The existing "password changed" email is sent.

Lost phone with the password known: sign in with password and a recovery code, then use "Set up on a new phone" (§4.4).
**Lost phone and lost recovery codes:** no self-serve path. Runbook `docs/runbooks/mfa-manual-reset.md`: verify identity out of band, run `scripts/mfa-reset.ts --user <id>` (deletes the TOTP, codes and trusted devices; bumps `tokenVersion`), and email the user.

## 4. Factors

### 4.1 Setup: Profile → Security

Only accounts with a password (`signInMethods.password`) can turn MFA on (D1). All setup and management routes use `requireAuth`, `reauthLimiter`, and a **password** proof (MFA guards the password, so the password is what we confirm).

1. **`POST /api/auth/mfa/totp/setup { password }`**: returns `409` if MFA is already on. Writes a fresh 20-byte `pending_secret_enc` and returns `{ secret, otpauthUri }` (issuer `OCRecipes`, label = username). Gated by `MFA_SETUP_ENABLED` (§8).
2. **`POST /api/auth/mfa/totp/confirm { code }`**: in one transaction it verifies against the pending secret (§4.2), promotes it, sets `confirmed_at` and `last_used_step`, creates 10 recovery codes, and bumps `tokenVersion` (plus cache invalidation). It emails "turned on" and returns `{ token, recoveryCodes }`.

The client opens `otpauthUri` with `Linking.openURL` **only** (`canOpenURL` would need an `LSApplicationQueriesSchemes` entry, i.e. a native build). If that fails, the copyable key is the fallback. There is no QR code.

### 4.2 TOTP

RFC 6238, written in-house on `node:crypto` (HMAC-SHA-1, 6 digits, 30-second step) and tested against the RFC's published vectors. **±1 step** is accepted, with a constant-time comparison. No new dependency.

**Replay guard:** accept step `s` only via `UPDATE user_totp SET last_used_step = $s WHERE user_id = $u AND (last_used_step IS NULL OR last_used_step < $s) RETURNING`. No row means a replay, which counts as a failure.

### 4.3 Recovery codes

- 10 codes, each 80 bits from `crypto.randomBytes`, shown as 16 base32 characters in groups of 4. Input is normalised (uppercase; spaces and dashes stripped) before hashing (§2).
- **Redemption plus replacement, one transaction:** `UPDATE mfa_recovery_codes SET used_at = now() WHERE user_id = $u AND code_hash = $h AND used_at IS NULL RETURNING`, then insert one new code. The "recovery code used" email is sent.
- **Delivery:** any response from a request that consumed a recovery code carries `replacementRecoveryCode`. That holds **even if the request then failed** (lost the challenge-consume race, link ticket expired), because the old code is gone either way. Exceptions: turning MFA off and regenerating, where all codes are replaced anyway, and deleting the account.
- A recovery code works anywhere a TOTP code does. Failures share the lockout counter (§6).
- **Regenerate:** `POST /api/auth/mfa/recovery-codes { password, secondFactor }` replaces all 10 and sends an email.

### 4.4 Turn off, new phone, forget trusted phones

- **Turn off:** `POST /api/auth/mfa/disable { password, secondFactor }`, one transaction. It deletes `user_totp`, the codes, the challenges and the trusted devices, and bumps `tokenVersion`. It sends an email and returns `{ token }`. (The 15+ character requirement for turning off arrives with part 3.)
- **New phone:** `POST /api/auth/mfa/totp/reset { password, secondFactor }` writes a new `pending_secret_enc` and returns `{ secret, otpauthUri }`. Confirming via `/totp/confirm` promotes it, **keeps** the existing recovery codes, deletes trusted devices, bumps `tokenVersion` and emails "set up on a new phone". The old secret keeps working until then.
- **Forget trusted phones:** `DELETE /api/auth/mfa/trusted-devices` (`requireAuth`) deletes them all.

## 5. Sessions and trust, summarised

| Event                 | Sessions (`tokenVersion`)  | Pending challenges | Trusted phones |
| --------------------- | -------------------------- | ------------------ | -------------- |
| Sign out              | ended                      | ended (version)    | **kept** (D5)  |
| Password reset        | ended                      | ended              | deleted        |
| MFA turned on         | ended (new token returned) | —                  | —              |
| MFA turned off        | ended (new token returned) | deleted            | deleted        |
| New phone confirmed   | ended (new token returned) | ended              | deleted        |
| Forget trusted phones | —                          | —                  | deleted        |

## 6. Limits and alerts

- **Per challenge:** 5 attempts.
- **Per account second factor**, kept separate from the password limiter. One statement:
  ```sql
  UPDATE user_totp
     SET failed_attempts = CASE WHEN failed_attempts + 1 >= 10 THEN 0 ELSE failed_attempts + 1 END,
         locked_until    = CASE WHEN failed_attempts + 1 >= 10 THEN now() + interval '15 minutes' ELSE locked_until END
   WHERE user_id = $1
  RETURNING (failed_attempts = 0) AS tripped;
  ```
  `tripped` is true only for the request that hit 10, and that one request sends the alert email. A success sets `failed_attempts = 0`. Every path that checks a factor (login, link, inline proofs, disable, regenerate, new phone) uses this. That's far below SP 800-63B-4's 100-failure ceiling.
- **Per IP:** a new `mfaVerifyLimiter` on `/api/auth/mfa/verify`. Setup and management reuse `reauthLimiter`.
- **Emails** (`server/services/email.ts`, shaped like `sendPasswordChangedNotice`): turned on, turned off, set up on a new phone, recovery code used, codes regenerated, and on lockout: **"Several wrong two-step verification codes were entered for your account. If this wasn't you, change your password."**

## 7. Client

- **`TwoStepCodeScreen`** (new root modal, plus `-utils`): opened by `mfa_required` from login and the Connect prompt. It has a 6-digit field (`textContentType="oneTimeCode"`, `keyboardType="number-pad"`), a "Trust this phone for 90 days" switch (login only), and a "Use a recovery code" toggle. When a response carries `replacementRecoveryCode`, it shows it with Copy before moving on. `MFA_CHALLENGE_EXPIRED` sends you back to the start with a message.
- **Inline proofs:** on `403 SECOND_FACTOR_REQUIRED`, the connect-sign-in-method, delete-account and change-email flows show the same code input (a shared component) and resend with `secondFactor`. The existing handlers (`ConnectAccountScreen-utils.ts:65`, `social-auth-utils.ts:42`) are rewritten for this meaning.
- **`TwoStepSetupScreen`** (new): password, then "Add to authenticator app" with the copyable key, then the code, then the recovery codes with Copy/Share and an "I've saved these" tick that's required to finish. The token from `/confirm` replaces the stored one.
- **`SettingsScreen` → Security:** Two-step verification on/off, Set up on a new phone, New recovery codes, Forget trusted phones. Accounts with no password see "Set a password to turn on two-step verification".
- **Trust key:** stored in secure store with `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`, under its own key in `client/lib/token-storage.ts`, and sent with every `/api/auth/login`. **Signing out leaves it alone** (D5). The server ignores it once it no longer matches a row.
- **`/api/auth/me`** gains `mfaEnabled` only. `signInMethods.password` already reports whether the account has a password.
- New interactive UI follows the `interaction-feel` skill.

## 8. Rollout

1. **Before the server deploys:** set `MFA_SECRET_ENC_KEY` on Railway (32 random bytes, base64, backed up like the other keys), and apply migration 0018 to prod.
2. The server ships with `MFA_SETUP_ENABLED` gating **only** `/totp/setup`. Every other path always honours an existing confirmed factor, so turning the flag off never removes protection.
3. Client: preview OTA, then the owner's device test (setup, sign out, code sign-in, trusted phone survives sign-out, recovery code and its replacement, Connect prompt, change email, reset then challenge), then production OTA and the flag flip. **No native build.**
4. Old app versions can only meet `mfa_required` or the new `SECOND_FACTOR_REQUIRED` meaning on an account that turned MFA on, and turning it on requires the new app.

## 9. Risks

- **`MFA_SECRET_ENC_KEY` loss or rotation locks out every MFA user** (their secrets can't be decrypted, so it's recovery codes or the manual runbook). Rotation needs a re-encrypt script. Treat the key like the database credentials.
- **Mailbox takeover can change the password** (D7). It can't get in (the challenge still applies), but the owner must reset back from the same mailbox. Accepted: the alternative made reset cost extra tries and opened a race.
- **Lost phone and lost codes means support.** Acceptable while the app has no users other than the owner. Revisit when it does.
- **A trusted phone is a standing bypass of the code for 90 days.** It still needs the password and the phone's own unlock. Mitigations: "Forget trusted phones", and deletion on reset, new phone and turning MFA off.
- **A future password-proof route that forgets the helper** would bring the D2 bypass back. Mitigation: the single helper (§3.3) plus a test that sweeps the route table for password-proof bodies.
- **Lockout as a nuisance:** someone with the password can lock the code check for 15 minutes. They already need the password, and the alert email tells the owner.

## 10. Rejected alternatives

- **An audience-scoped JWT for the challenge:** it's only safe if every token check also checks the audience, and per-challenge counting needs server state anyway.
- **Password and code on one screen:** it reveals MFA status before the password check.
- **A QR code at setup:** a phone can't scan itself.
- **Requiring the factor for password reset** (rev 1 §5): reset never issues a session, so it added nothing. It used up reset tries and created a consumed-code race.
- **Trust tied to `tokenVersion`:** any sign-out on any phone would cancel all trust (D5).
- **`otplib`:** HOTP/TOTP is about 20 lines against published vectors, so not worth a dependency in the auth path.

## 11. Testing (TDD, written first)

**Real Postgres** (`test/db-test-utils`, as in `users-password-reset.test.ts`): the replay guard (concurrent same-step submissions, exactly one wins), challenge single use under concurrency, recovery-code redemption under concurrency, the lockout `UPDATE` (`tripped` true exactly once at 10), cascades, unique constraints, the purpose/pending CHECK, cleanup-job deletion, and that migration 0018 matches `shared/schema.ts`.

**Route tests using the real `requireAuth`** (not mocked):

- The raw challenge token is rejected as a bearer token.
- Login without MFA is unchanged. Login with MFA stops at the challenge. A valid trust key skips it. A trust key that's expired, for the wrong user, or forgotten doesn't. **Sign out, then a trusted-phone sign-in, skips the code** (D5).
- Verify: wrong code, 5-attempt cap, expired challenge, a challenge from an older `tokenVersion` (reset mid-challenge) is rejected, recovery code plus `replacementRecoveryCode`.
- Already-connected Google/Apple sign-in on an MFA account issues a session. `/social/link` **password branch** returns `mfa_required` and links only after verify. **Provider branch** links with no code. No auto-link for an MFA account.
- `/identities`, `DELETE /account` and `/change-email` with password proof on an MFA account: no factor gives 403 `SECOND_FACTOR_REQUIRED`, a wrong factor gives 401 and the counter goes up, the right factor succeeds. With a connected-identity proof, no factor needed.
- Reset on an MFA account: same shapes as today, MFA stays on, trusted devices deleted, the pending challenge is dead.
- Turning on, off and new phone: `tokenVersion` bumped, cache invalidated, a new token returned, and the effects in §5 hold. Setup is refused for a social-only account, when MFA is already on, and when the flag is off.

**Unit:** TOTP against the RFC 6238 vectors and the ±1 window, base32, recovery-code generation and normalisation.

**Client `-utils`:** routing on `mfa_required` / `SECOND_FACTOR_REQUIRED` / a token, recovery-code input normalisation, and the "I've saved these" gate.
