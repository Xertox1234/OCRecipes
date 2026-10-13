# Change password (signed in) — design

> **Date:** 2026-10-11 · **Status:** approved in conversation, awaiting spec review
> **Origin:** auth audit 2026-10-10 L5 → `docs/runbooks/password-reset-lockout.md` "Open decision". Owner chose to build it 2026-10-11.
> **Risk class:** auth — by hand, TDD, security-auditor review, owner yes before merge. Never delegated to cheap workers.

## 1. Problem and goal

Forgot password allows 6 codes per account per fixed 24 h window, and 5 wrong guesses kill a code. Anyone who knows an address can use both up every window, so the owner is locked out of email recovery for as long as the attacker keeps going (accepted risk L5). There is also no way at all to change a password from inside the app.

**Goal:** a person who can prove who they are some other way can always set a new password, and a stranger who knows only the email cannot block it.

**Success:** with the Forgot password cap exhausted for an address, the signed-in owner of that address can still set a new password, by any of the three proofs below.

## 2. Decisions (owner, 2026-10-11)

| #   | Decision                                                                                                                                                                                                                   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Proof when the password is forgotten: a fresh **Google/Apple** confirmation (if connected) **or an emailed code**. Being signed in alone is never enough.                                                                  |
| D2  | One **Change password** screen also serves the everyday case: the **current password** is a proof too.                                                                                                                     |
| D3  | The emailed code is **its own code** in its own table (approach A) — not the Forgot password code. Only a signed-in session can request it, so a stranger can't use up its limits or overwrite it. Needs migration `0022`. |
| D4  | Password-less accounts (created with Google/Apple) get the same screen as **Set a password**.                                                                                                                              |
| D5  | No feature flag: the app has no users and the screen ships by OTA after the server is live.                                                                                                                                |

**Honest limit (state it, don't hide it):** the emailed-code proof is as strong as today's Forgot password — someone holding the unlocked phone can likely open the mail app. It is not stronger; it just cannot be blocked by a stranger. The password and Google/Apple proofs are stronger, and two-step accounts add the authenticator code (§4.3).

## 3. What the person sees

**Profile → Sign-in methods → Change password** (or **Set a password** when the account has none).

1. **Current password** field, with **"I forgot it"** below. (Hidden on a password-less account — it starts at step 2.)
2. **"I forgot it"** shows:
   - **Confirm with Google** / **Confirm with Apple** — only the providers connected to this account;
   - **Email me a code** — sends a 6-digit code to the account's current email; a field to type it appears.
3. **New password** — the usual rules: 15+ characters, or 8+ when two-step is on; breach-checked.
4. **Authenticator code** (or a recovery code) when two-step is on and the proof is the current password or an emailed code. A Google/Apple confirmation doesn't need it (existing rule D1 of the 2FA spec).
5. **Save** → this phone stays signed in; every other device is signed out; trusted phones are forgotten; a pending email change is cancelled; the password-changed email goes out, naming connected Google/Apple sign-ins.

Messages (plain words):

- wrong current password / failed Google-Apple check → "That didn't match. Try again."
- wrong, expired or used-up code → "That code didn't work. Request a new one."
- code limit reached → "You've requested too many codes today. Try again tomorrow, or use Google/Apple." (Safe: the person is signed in as the owner; nothing is enumerated.)
- reset / sign-out elsewhere landed mid-request → "Please sign in again."

## 4. Server

### 4.1 Routes (both `requireAuth`)

**`POST /api/auth/change-password/code`** — send a code.

- Limiters: a new in-memory `changePasswordCodeLimiter` (3 / h, user-keyed) in front; the durable cap (§4.2) is the real bound.
- `storage.issuePasswordChangeCode(userId, codeHash)` → false at the cap → **429** `RATE_LIMITED`, message from §3.
- Sends the code to `user.email` (never `pendingEmail`) with a new `sendPasswordChangeCode` (account-security bucket — only a signed-in session can trigger it, per `attacker-triggered-mail-sharing-the-recovery-budget-starves-recovery-2026-10-11.md`). Fire-and-forget; answers `{ status: "code_sent" }`.

**`POST /api/auth/change-password`** — set the password. Limiter: existing `reauthLimiter` (5 / h, user-keyed).

Body (new `changePasswordSchema`):

```ts
{
  proof:
    | { password: string; secondFactor?: SecondFactorProof }      // D2 — existing reauthProofSchema variant
    | { provider: "google" | "apple"; idToken; nonce }            // D1 — existing reauthProofSchema variant
    | { emailCode: string /* 6 digits */; secondFactor?: SecondFactorProof }, // D1/D3 — new
  newPassword: string,           // schema floor 8; real minimum in checkNewPassword
}
```

`proof` is `z.union([...reauthProofSchema.options, emailCodeProofSchema])`, so the two existing variants keep exactly the shape `reauthProofSchema` already gives them — `secondFactor` sits **inside** the proof, as the delete-account route reads it (`validated.secondFactor`). A `password`/`provider` proof is passed to `reauthenticate()` unchanged.

Order:

1. Load the user with `getUserForAuth` (hash + `tokenVersion` + `mfaEnabledAt`). Gone → 404.
2. **Proof.**
   - `password` / `provider` → existing `reauthenticate(userId, user.password, proof)`. A `password` proof on a password-less account → 401: `passwordMatches(input, null)` compares against a dummy hash (same cost) and returns false — it never throws.
   - `emailCode` → `storage.reservePasswordChangeAttempt(userId)` (atomic; increments `attempts`; returns the live hash only when unexpired and under 5 attempts) then `changeCodeMatches(userId, code, hash)` (constant-time). Miss → 400 `INVALID_RESET_CODE` (the existing code; same meaning), §3 message.
   - Failed password/provider proof → 401 `UNAUTHORIZED`.
3. **Second factor** — `secondFactorForPasswordProof(user, proofIsPassword = "password" in proof || "emailCode" in proof, proof.secondFactor)`. Passing `true` for an email code is **deliberate**: like a password, an emailed code is one factor, so the 2FA spec's D2 rule (one factor alone is not enough on a two-step account) applies to it; only a Google/Apple confirmation is exempt (D1). Carries `replacementRecoveryCode` on every later answer (existing pattern).
4. **Policy** — `checkNewPassword(newPassword, mfa ? PASSWORD_MIN_WITH_MFA : PASSWORD_MIN_SINGLE_FACTOR, mfa ? "mfa" : "single_factor")`.
5. **Commit** — `storage.changePassword({ userId, expectedTokenVersion: user.tokenVersion, newPasswordHash, consumeCodeHash? })` (§4.2). `undefined` → 401 `TOKEN_REVOKED`, "Please sign in again" — the code `requireAuth` itself uses, so the app's 401 interceptor signs the phone out. That is the honest outcome: a reset, sign-out everywhere or delete landed and already revoked this session.
6. `invalidateTokenVersionCache(userId)`; `issueSession(userId, newVersion)` (required-version rule, #1377); `sendPasswordChangedNotice(email, username, connected)` fire-and-forget (same lookup as the reset route).
7. Answer `{ status: "signed_in", user, token }` (the shape the client already stores).

### 4.2 Storage — table `password_change_codes` (migration `0022`)

```
user_id       varchar PK  → users(id) ON DELETE CASCADE
code_hash     text        NULL   -- HMAC of the live code; NULL when none
expires_at    timestamptz NULL   -- now() + 15 min at issue
attempts      integer NOT NULL DEFAULT 0   -- wrong guesses on the live code, max 5
issue_count   integer NOT NULL DEFAULT 0   -- codes issued in the window, max 5
window_start  timestamptz NOT NULL         -- fixed 24 h window from the first code
```

Its own table, not columns on `users`: a deploy that ever beats the migration breaks only this feature, never every `users` read (the `0021` reasoning).

- `issuePasswordChangeCode(userId, codeHash)` — one upsert: new code, `attempts = 0`, `expires_at = now() + 15 min`, `issue_count`/`window_start` restarted when the window has passed; `setWhere (window expired OR issue_count < 5)`. Returns false at the cap. Same shape as `issuePasswordResetCode`.
- `reservePasswordChangeAttempt(userId)` — `UPDATE … SET attempts = attempts + 1 WHERE user_id = $1 AND code_hash IS NOT NULL AND expires_at > now() AND attempts < 5 RETURNING code_hash`.
- `changePassword({ userId, expectedTokenVersion, newPasswordHash, consumeCodeHash })` — one transaction:
  - `UPDATE users SET password, token_version + 1, pending_email = NULL, ...CLEARED_RESET_CODE WHERE id = $1 AND token_version = $expected RETURNING token_version`; no row → return `undefined`. Clearing a live Forgot password code follows the rule `completePasswordReset` and the email-change commit already apply (a password or recovery-address change kills any reset code issued). The `password_change_codes` issue window is **not** reset — its cap must persist;
  - `DELETE FROM mfa_trusted_devices WHERE user_id = $1` (as `completePasswordReset`, D7);
  - when `consumeCodeHash` is given: `UPDATE password_change_codes SET code_hash = NULL WHERE user_id = $1 AND code_hash = $consumeCodeHash` and require one row, else roll back and return `undefined` (a code used twice concurrently commits once).
  - Returns the new `tokenVersion`.
- `emailVerified` is **not** touched (unlike reset, which proves the inbox): a password/Google proof says nothing about the inbox.

**Code hash:** a new `hashChangeCode(userId, code)` = HMAC over `` `pw-change:${userId}:${code}` `` with the reset-code key, so a change-code hash never equals a reset-code hash for the same digits. `changeCodeMatches` mirrors `resetCodeMatches` (constant time, burns the compare on malformed input).

### 4.3 Why each bound holds

| Threat                                           | Bound                                                                                                                           |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Stranger knowing only the email blocks the owner | Can't reach either route (`requireAuth`); the Forgot password columns are untouched.                                            |
| Stolen session guesses the emailed code          | 5 guesses × 5 codes per 24 h window = 25 per account per window, all durable.                                                   |
| Stolen session guesses the current password      | `reauthLimiter` 5 / h per user — the same exposure as account deletion today.                                                   |
| Stolen session + unlocked phone with mail        | Equals today's Forgot password (stated in §2). Two-step accounts also need the authenticator.                                   |
| Concurrent reset / sign-out everywhere           | `changePassword` pins `expectedTokenVersion`; the later writer fails, the session is minted under the version this request set. |
| Same code used twice at once                     | Consumed inside the commit transaction; one wins.                                                                               |
| Short-password sign-in pass (#1370)              | An opaque pass, never a JWT: `requireAuth` rejects it.                                                                          |

## 5. App

- New `ChangePasswordScreen` (+ `ChangePasswordScreen-utils.ts` for the pure logic: which options show, message mapping), registered in `RootStackNavigator`, reached from `SignInMethodsScreen`.
- `useAuth.changePassword(...)` and `useAuth.requestPasswordChangeCode()`. The new session is stored only if `tokenStorage.get()` is unchanged since the request started (the L7 stale-reply rule, `request-dispatched-in-one-session-lands-in-the-next-2026-10-11.md`).
- Google/Apple confirmation reuses the existing reauth helpers used by Connect / Delete account (nonce from `/api/auth/social/nonce` with purpose `reauth`).
- `replacementRecoveryCode` on any answer is shown with the existing component.
- React Compiler rule: no `?.`/`&&`/ternary inside a `try` (`react-compiler-bails-on-a-conditional-inside-a-try-2026-10-10.md`).

## 6. Testing (each test red before its code)

- **Storage (real DB) — the success criterion (§1):** call `issuePasswordResetCode` until it refuses (7th → false) for a user, then `issuePasswordChangeCode` for the same user → true; and the reverse (change-code cap exhausted → a reset code still issues). Route tests mock storage wholesale, so this independence can only be proven here.
- **Storage (real DB):** issue cap (6th code refused; window restart); guess cap (6th refused); expiry; `changePassword` sets hash, bumps version, clears `pendingEmail` and trusted phones, consumes the code; refused when the version moved; refused when the code was already consumed; a live reset code is cleared; the change-code issue window survives the commit; `emailVerified` untouched.
- **Code hash:** a change hash ≠ the reset hash for the same user and digits; malformed hash → false.
- **Routes:** each proof (password, Google, Apple, emailCode); wrong proof → 401 / 400; two-step required for password and emailCode, not for Google/Apple; recovery-code replacement rides the answer; policy and breach rejection; new session under the new version; cache invalidated; notice sent; password-less account accepts provider/emailCode and rejects password; both 429s; the commit is called with the version the route loaded. (The cap-independence regression lives in the storage tests above — here it would only test mocks.)
- **App:** utils (options per account shape, message mapping); `useAuth` stale-reply guard; navigation entry from Sign-in methods.

## 7. Delivery

1. **Server PR** — migration `0022`, schema, storage, routes, email sender, tests. Owner applies `0022` on prod and pastes `to_regclass('public.password_change_codes')` before merge. Runbook `password-reset-lockout.md` "Open decision" becomes "Change password (signed in)". From merge, both routes are **reachable by any signed-in token** (and fully guarded as §4 describes) but not surfaced in the app until the OTA.
2. **App PR** — screen, hook, navigation, tests. Merged after the server is live; then an OTA (pull main into the main checkout first).

Both `security`-labelled: security-auditor + server-reviewer / mobile-reviewer, owner yes before merge.

## 8. Out of scope

- Changing the Forgot password flow or its caps (the accepted risk stays; this adds a way around it).
- A web version of the screen.
- Letting a signed-out person use Google/Apple to skip the code — they sign in with Google/Apple first (that already works), then use this screen.
