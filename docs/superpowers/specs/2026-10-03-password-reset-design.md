# Password Reset and Sign-In by Email — Design

- **Date:** 2026-10-03
- **Todo:** `todos/P1-2026-09-26-no-password-reset-or-account-recovery.md` (human-led, `security`)
- **Status:** owner approved the flow (§2), approach A, and the server/client/rollout design in the brainstorming conversation on 2026-10-03. The written spec was revised after a spec-review pass the same day; awaiting the owner's spec review.

## 1. Goal

A user who forgets their password or their username can get back into their account on their own, from the login screen, with no human help.

### Decisions (owner-approved 2026-10-03)

| Decision                                            | Choice                                                                                                                                                               |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| How the reset credential reaches the app            | A **6-digit code** typed into the app. No universal links, no custom-scheme links.                                                                                   |
| Where the code lives                                | **Three nullable columns on `users`**, at most one live code per account.                                                                                            |
| Username recovery                                   | **Login accepts username or email.** No "forgot username" email.                                                                                                     |
| After a successful reset                            | Back to **Login** (no session issued); email prefilled; toast.                                                                                                       |
| Does a reset verify the email?                      | **Yes.** Receiving the code proves control of the inbox.                                                                                                             |
| "Wasn't you?" contact                               | **support@ocrecipes.app.** The owner sets up the mailbox or forward before launch.                                                                                   |
| Password rule for the reset form                    | **Today's register rule** (8+ chars, a letter, a digit), extracted to one shared fragment. `P2-2026-09-26-password-length-policy.md` tightens it later in one place. |
| Related gap 2 (signup-attempt email lacks username) | **Fixed here.**                                                                                                                                                      |
| Related gap 3 (missing-user login returns faster)   | **Fixed here** by a dummy `bcrypt.compare`.                                                                                                                          |
| How it's implemented                                | **Inline in the main session.** Never the `/todo` executor or any delegated implementer: `server/routes/auth.ts` is a hard-exclusion path.                           |

### Settled facts that need no re-deciding

- The owner's own lockout was resolved 2026-09-26. The todo's "one-off manual recovery" note is stale.
- Universal/app links need a hosted AASA/assetlinks file and a native build, but the owner's device takes OTA only. A code ships by OTA and behaves the same on iOS and Android.
- A 5-guess cap needs server-side state, so a stateless reset JWT is off the table. The todo's JWT-audience and fingerprint notes don't apply.

### Out of scope

Universal links, MFA, the 15-character policy, Google/Apple sign-in. Each has its own todo.

## 2. User flow

1. **Login screen.** The first field is labeled **"Username or email"**. In login mode only, a **"Forgot password?"** text link sits under the password field.
2. **Forgot Password screen.** One email field and **Send code**. Whatever is entered, the screen shows _"If an account uses that email, we've sent a 6-digit code. It expires in 15 minutes."_ and moves to step 3. The one exception is the hourly per-email limit: the screen stays put and says _"Too many code requests for this email. Try again in an hour."_ That limit trips the same way for real and unknown addresses, so the message reveals nothing.
3. **Reset Password screen.** Code, new password, confirm password, and **Resend code** (disabled for 60 s after each send). Every failure shows _"That code is incorrect or expired. After 5 wrong tries, request a new code."_ The screen never says the tries are used up: that message would reveal a code exists for the email.
4. **Success.** Navigate to `Login` with the email prefilled and the toast _"Password updated. Sign in with your new password."_ All other sessions are revoked immediately. A **"Your OCRecipes password was changed"** email goes to the account. It includes the username (so it also serves as a username reminder) and says _"If this wasn't you, contact support@ocrecipes.app."_

No new deep links. Both new screens join the logged-out stack in `RootStackNavigator`.

## 3. Data model

New nullable columns on `users` (`shared/schema.ts`):

| Column                     | Type                         | Meaning                                                        |
| -------------------------- | ---------------------------- | -------------------------------------------------------------- |
| `reset_code_hash`          | `text`                       | HMAC-SHA256 hex of `userId:code`; NULL means no live code      |
| `reset_code_expires_at`    | `timestamp with time zone`   | Written as `now() + interval '15 minutes'` in SQL              |
| `reset_code_attempts`      | `integer NOT NULL DEFAULT 0` | Failed plus in-flight guesses against the current code         |
| `reset_issue_count`        | `integer NOT NULL DEFAULT 0` | Codes issued in the current 24 h window (durable issuance cap) |
| `reset_issue_window_start` | `timestamp with time zone`   | Start of that window; NULL means no window open                |

- **Time zones:** both timestamps use `withTimezone: true`, like every other timestamp on `users`. Expiry and window are computed and compared **in SQL against `now()`**, never against a JS `Date`, so writing and checking both use the database clock (`docs/rules/database.md`: a zone-less timestamp loses its offset when it goes to Postgres and back).
- **These columns are excluded from `SafeUser`**, in both places: the `safeUserColumns` destructure (`server/storage/users.ts:40`, today "every column except `password`") and the `SafeUser` type (`users.ts:43`, today `Omit<User, "password">`). Both must drop all five, or the type and the runtime columns disagree.
- **The real guard is response shaping.** The full-row paths (`createUser`, `updateUser … .returning()`, the `*ForAuth` getters) still return these columns. That is safe because every HTTP response is built by `serializeUser` or an explicit field pick. Keep it that way. Do not "fix" it by stripping columns in storage.
- **HMAC key:** `HMAC-SHA256(JWT_SECRET, "password-reset-code:v1")`, computed once at module load. No new env var. Rotating `JWT_SECRET` invalidates live codes, which is acceptable. Plain SHA-256 over a 10⁶ space is recoverable from a DB leak in milliseconds; the keyed HMAC is not.
- Codes are never logged, and never returned in any response.

### When a code dies

| Event                                         | Effect                                                                                                                                                                                                                                                                              |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A new code is requested                       | Overwrites hash, expiry, and attempts = 0 (the old code dies)                                                                                                                                                                                                                       |
| Successful reset                              | All three code columns cleared in the same UPDATE as the password                                                                                                                                                                                                                   |
| Successful reset (staged email change)        | The same UPDATE sets `pending_email = NULL`. An outstanding change-email link (a 24 h JWT with no `tokenVersion`) then matches nothing in `applyEmailVerification`, so an attacker who staged their address with a known password can't complete the change after the owner resets. |
| Email change **committed**, verification on   | `applyEmailVerification` branch 2 also clears the columns                                                                                                                                                                                                                           |
| Email change **committed**, verification off  | `updateUserEmail` also clears the columns                                                                                                                                                                                                                                           |
| Email change **staged** (`stagePendingEmail`) | No effect: the verified address hasn't changed                                                                                                                                                                                                                                      |
| Expiry or 5 attempts                          | Rejected by the consume query's predicate (the row stays until overwritten or cleared)                                                                                                                                                                                              |

## 4. Server

New code lives in `server/lib/password-reset-code.ts` (generate, HMAC, constant-time compare: pure, unit-testable) and in new storage functions in `server/storage/users.ts`. Routes go in `server/routes/auth.ts`; schemas in `server/routes/_schemas.ts`; limiters in `server/routes/_rate-limiters.ts`; mail in `server/services/email.ts`.

### 4.1 `POST /api/auth/forgot-password` — public

Body: `{ email }` (trimmed and lowercased by Zod, like `registerSchema`).

1. **Rate limits before any DB work** (route middleware, so they also run before Zod validation; malformed requests count against them too): **10 / 15 min per IP**, and **3 / hour per email**, keyed with the existing `normalizeUsernameKey` (trim, lowercase) and falling back to the IP key when no email is present, like `loginAccountLimiter`. Because they run before the lookup, a 429 doesn't reveal whether the account exists, so the client may show its message honestly (§5.1).
2. Look up by the verified `email` column only (`getUserByEmail`, which matches `email`, never `pendingEmail`). Accounts with an unverified `email` still qualify; a completed reset verifies them.
3. **On both branches:** generate the code (`crypto.randomInt(0, 1_000_000)`, zero-padded to 6) and compute its HMAC. For a missing account, use a fixed dummy user id. The awaited work is one lookup plus one HMAC either way.
4. If the account exists: `fireAndForget("password-reset-code", issueThenSend())`. The task runs one atomic UPDATE that enforces the **durable issuance cap** (6 per fixed 24 h window starting at the first code) and stores the code together:
   ```sql
   UPDATE users SET
     reset_code_hash = $hash,
     reset_code_expires_at = now() + interval '15 minutes',
     reset_code_attempts = 0,
     reset_issue_count = CASE WHEN reset_issue_window_start IS NULL
         OR reset_issue_window_start <= now() - interval '24 hours'
       THEN 1 ELSE reset_issue_count + 1 END,
     reset_issue_window_start = CASE WHEN reset_issue_window_start IS NULL
         OR reset_issue_window_start <= now() - interval '24 hours'
       THEN now() ELSE reset_issue_window_start END
   WHERE id = $id AND (reset_issue_window_start IS NULL
     OR reset_issue_window_start <= now() - interval '24 hours'
     OR reset_issue_count < 6)
   RETURNING id
   ```
   Zero rows means the daily cap was hit: the code is **not** stored and **no email is sent**, and this stays silent (it applies only to real accounts, so surfacing it would reveal that the account exists). Otherwise the code email is sent. Storing inside the background task keeps the DB write out of the response time. Unlike the in-memory limiters, this cap survives deploys.
5. Always return `200 { status: "reset_code_sent", message: <the neutral text> }`.

### 4.2 `POST /api/auth/reset-password` — public

Body: `{ email, code, newPassword }`. `code` is `^\d{6}$`; `newPassword` uses the shared password fragment.

1. **Rate limits** (route middleware, so they run first, before validation): **20 / 15 min per IP**, and **10 / 15 min per email** via `normalizeUsernameKey` with the IP fallback.
2. **Validate before touching the code.** A weak password or a malformed code returns the normal 400 `VALIDATION_ERROR` without using up a **code attempt** (the DB counter), though it does count against the limiters above. Validation doesn't depend on the account.
3. **Use up an attempt atomically.** The identical query runs for every email:
   ```sql
   UPDATE users SET reset_code_attempts = reset_code_attempts + 1
   WHERE lower(email) = $1 AND reset_code_hash IS NOT NULL
     AND reset_code_expires_at > now() AND reset_code_attempts < 5
   RETURNING id, username, email, reset_code_hash
   ```
   Concurrent guesses cannot get past 5: each one increments under the row lock.
4. Compute the HMAC of the submitted code (with a dummy id and dummy stored hash when no row came back) and compare using `crypto.timingSafeEqual`.
5. **Every failure returns one identical response:** `400 { code: "INVALID_RESET_CODE", error: "That code is incorrect or expired." }`. This covers a wrong code, an expired code, a used-up code, no live code, and an unknown email.
6. **On success:**
   - `bcrypt.hash(newPassword, 12)`.
   - One UPDATE: `password = newHash, token_version = token_version + 1, email_verified = true, pending_email = NULL`, clear the three code columns (the issuance counters stay), `WHERE id = $id AND reset_code_hash = <matched hash>`. Zero rows (a code reissued in the meantime) is treated as the uniform failure.
   - `invalidateTokenVersionCache(id)`. The increment alone leaves stolen sessions alive for up to 60 s (`server/middleware/auth.ts`).
   - `fireAndForget("password-changed-notice", sendPasswordChangedNotice(email, username))`.
   - Return `200 { status: "password_reset" }`. **No token is issued.**

`INVALID_RESET_CODE` is added to `@shared/constants/error-codes`.

### 4.3 Login accepts username or email

`POST /api/auth/login` keeps the body field name `username`, so installed app versions keep working.

- `loginSchema.username`: `.trim()`, `max(254)`.
- If the value contains `@`: lowercase it and look it up by email (new `getUserByEmailForAuth`, which matches `email` only, never `pendingEmail`). Otherwise use the exact `getUserByUsernameForAuth` as today. Usernames are `^[a-zA-Z0-9_]+$`, so the two never collide, and usernames are **not** lowercased (stored mixed-case names must keep matching).
- **Missing-user branch:** `await bcrypt.compare(password, DUMMY_HASH)` against a fixed cost-12 hash constant before the 401, so both failures take about the same time (fixes gap 3).
- `loginAccountLimiter` keys on the normalized typed identifier, so one account has **two buckets** (by username and by email): at most 20 failed tries per 15 min instead of 10. Sharing one bucket would need an account lookup before the limiter, and that lookup is itself an existence oracle. Accepted trade-off. The limiter's key comes from `normalizeUsernameKey`, which already trims and lowercases (existing behavior, unchanged), so case variants of an email already share a bucket.

### 4.4 Email templates (`server/services/email.ts`)

All new senders gate on `emailVerificationEnabled()` (that is, Resend is configured).

**Their own per-recipient bucket.** Today's `canSendTo` is **one** 5/hour budget shared by all mail to an address, and anyone who knows the address can drain it with signup-attempt notices (register is limited per IP only). A drained bucket would silently drop the reset code after the user was told "we've sent a code", or drop the security notice. So `canSendTo` gains a bucket parameter: `"general"` (signup notice and verification, unchanged at 5/hour) and `"account-security"` (reset code plus password-changed notice, **10/hour**, above the most the route and issuance caps can generate). Neither bucket can starve the other.

- **`sendPasswordResetCode(to, code)`.** Subject: "Your OCRecipes password reset code". Body: the code in large type, "expires in 15 minutes", "if you didn't ask, ignore this email: your password hasn't changed". The code must never appear in a log line; on failure, log only the Resend error.
- **`sendPasswordChangedNotice(to, username)`.** Subject: "Your OCRecipes password was changed". Includes the username and "If this wasn't you, contact support@ocrecipes.app."
- **`sendSignupAttemptNotice`** (gap 2) gains the username and "Forgot your password? Use 'Forgot password?' on the sign-in screen." The register handler passes `existingEmail.username`.
- All interpolated values are HTML-escaped (usernames are a restricted charset, but escape anyway). No escape helper exists in `server/` today (only `escapeLike`), so add `server/lib/html-escape.ts` (`escapeHtml`, covering `& < > " '`) with its own unit test.

### 4.5 Required wiring chores

- Add both routes to `PUBLIC_ROUTES` in `server/routes/__tests__/auth-route-wiring.test.ts` with a reason, or the static scan fails.
- Every limiter must be an inline-traceable `rateLimit({...})` / `createRateLimiter({...})` export, or CodeQL flags `js/missing-rate-limiting`.
- `resolveRateLimitMax` for the new limiters, so the E2E suite can relax them as it does the others.
- The rate-limit counters are in memory (single Railway instance) and reset on deploy. The 5-guess cap is in the DB and survives deploys.

### 4.6 Brute-force bound

5 guesses per code × 6 codes per account per fixed 24 h window = **30 guesses per window** (up to ~55 in a 24 h span that crosses a window edge, which fits 11 codes) against 10⁶ codes: about 1% for an attacker running nonstop against one account for a year, while the victim receives every code email. **Both caps are in the database**, so this holds no matter how often the server deploys. (An in-memory day cap would have reset on every deploy, and `main` took 11–30 merges a day in the week of 2026-09-26, which would have multiplied the bound by roughly that factor.) Consistent with SP 800-63B-4: a 6-digit code is allowed when the attempt cap is enforced, and email-sent recovery codes must expire within 24 h (here, 15 min).

## 5. Client

### 5.1 Screens and navigation

- `RootStackParamList` gains `ForgotPassword: { email?: string } | undefined` and `ResetPassword: { email: string }`. `Login` gains optional params `{ email?: string; passwordReset?: boolean }`, used to prefill the identifier and fire the success toast once.
- Both screens register in the logged-out branch of `RootStackNavigator`. The header follows the 2026-10-02 rule: a static `title` string, never a function `headerTitle` (which leaks the route name into the iOS back button). The back label is "Back".
- `LoginScreen`: relabel the field, set `autoComplete="username"` and `textContentType="username"`, and add the "Forgot password?" link (login mode only), which passes the typed identifier when it contains `@`.
- `ForgotPasswordScreen`: an email field (`keyboardType="email-address"`, `autoComplete="email"`, `textContentType="emailAddress"`) and a **Send code** button with a loading state. On 200, move on to `ResetPassword`. On **429** (a pre-lookup limiter, so not an existence oracle), stay on the screen and show _"Too many code requests for this email. Try again in an hour."_ A network error shows `InlineError`. Under the Resend link, the Reset screen shows _"Didn't get it? Check your spam folder, and use the most recent email."_
- `ResetPasswordScreen`: the code field (`keyboardType="number-pad"`, `textContentType="oneTimeCode"`, `autoComplete="one-time-code"`, maxLength 6), new password and confirm (`textContentType="newPassword"`, `autoComplete="new-password"`, secure entry), **Reset password**, and **Resend code** (60 s cooldown with a visible countdown). On success, `navigation.reset` to `Login` with params.
- API calls go through the existing `apiRequest` helper, never raw `fetch`. Neither endpoint touches `AuthContext` tokens.

### 5.2 Design system (owner requirement)

The new screens must look like part of the app, not a bolted-on form:

- **Only existing primitives:** `ThemedView`, `ThemedText`, `TextInput`, `Button`, `InlineError`, `KeyboardAwareScrollViewCompat`, and `ToastContext` for the success toast. No new one-off input or button components.
- **Tokens only:** colors from `useTheme()`, never raw hex (`docs/rules/design-system.md`). Text links use `theme.link`, and any solid fill behind white content uses `theme.accentSolid`. Spacing comes from `Spacing`, type from `Typography`, radii from `BorderRadius`. `withOpacity` comes from `@/constants/theme`.
- **Visual continuity with Login:** same horizontal padding, field spacing, button sizing, and heading treatment as `LoginScreen` / `VerifyEmailScreen`, so the three read as one flow.
- **Interaction feel:** haptic feedback via `useHaptics` on submit and success (matching `LoginScreen`), press states on the text links, a disabled-with-countdown state on Resend.
- **Accessibility** (`docs/rules/accessibility.md`): every input and link has an `accessibilityLabel`, errors are announced (`InlineError` behavior), the countdown has a readable label, and touch targets are at least 44 pt. Verified in light and dark mode.
- **Implementation process:** the plan runs the `frontend-design` skill on the two new screens and the `interaction-feel` skill on the login link and the new forms, and verifies with `verify-ui` in the iOS Simulator (both color schemes).

### 5.3 Testable logic

Validation, error-code → message mapping, and cooldown math live in `ForgotPasswordScreen-utils.ts` / `ResetPasswordScreen-utils.ts`, mirroring `LoginScreen-utils.ts`. The shared password rule is one Zod fragment in `shared/` (e.g. `shared/schemas/password.ts`), imported by `registerSchema`, the reset schema, and the client validators.

## 6. Testing

TDD throughout: each behavior gets a failing test first.

**Server: pure (`password-reset-code`)**

- A code is always 6 digits (including leading zeros); the HMAC is deterministic per `userId:code` and differs across users; the compare rejects a wrong code and malformed hex.

**Server: storage, against the real test DB**

- Issue → consume succeeds once; a second consume fails (reused).
- Expired (`expires_at` in the past) → fails.
- **5 concurrent wrong guesses** → attempts = 5; a 6th request with the **correct** code fails.
- A new issue resets attempts and kills the old code.
- `applyEmailVerification` branch 2 and `updateUserEmail` clear the columns; `stagePendingEmail` does not.
- The consume query never matches on `pending_email`.
- `SafeUser` / `getUser` results contain none of the five columns.
- **Reset cancels a staged email change:** stage address X, sign X's verification token, complete a reset; `applyEmailVerification(id, X)` then updates 0 rows and `email` is unchanged.
- **Durable issuance cap:** 6 issues in a window succeed and the 7th returns 0 rows (no code stored); after the window start is moved back 24 h, issuing works again.
- **Time zone:** with the session set to `SET TIME ZONE 'America/Los_Angeles'` (and `'Asia/Tokyo'`), a fresh code is live and one whose expiry is moved 16 min into the past is rejected.

**Server: routes**

- forgot-password: same status and body for an existing, unknown, and `pendingEmail`-only address; the send happens only for an existing account (mocked email service); per-email and per-IP 429s; the per-email limiter's key equals the Zod-normalized email (`"  Foo@X.com "` and `"foo@x.com"` share a bucket); a code never appears in logger calls; daily cap reached → same 200, no send.
- Email service: with the `"general"` bucket exhausted for an address, a reset code **and** a password-changed notice to that address still send; `escapeHtml` escapes all five characters.
- reset-password: happy path (password changed, `email_verified` true, columns cleared, notice sent, no token in the body); wrong / expired / burned / unknown email all return the byte-identical 400; a weak password returns `VALIDATION_ERROR` with attempts unchanged.
- **Session revocation through the real middleware:** a token issued before the reset is rejected by the real `requireAuth` immediately after (cache invalidated), not after 60 s. Extends `auth-route-wiring.test.ts` or the real-middleware suite, never the mocked auth.
- login: by email (any case) works; by username unchanged; an `@`-containing value never reaches the username lookup; the missing-user branch calls `bcrypt.compare`; `loginAccountLimiter` buckets an email case-insensitively.
- Signup-attempt notice includes the username.

**Client**

- Utils: validation, the uniform error message for `INVALID_RESET_CODE`, cooldown remaining-seconds math.
- Render tests (`renderComponent` harness) for both screens: fields present with labels, submit disabled while loading, navigation on success, the Login link visible in login mode only.

## 7. Rollout

1. Merge after **one** review pass: `security-auditor` + `code-reviewer` (+ `mobile-reviewer` for the screens). **Never auto-merged** (`security` label).
2. Schema push to production (three nullable or defaulted columns: additive, no backfill), then the server deploys on Railway. Old app versions are unaffected.
3. The client ships by **preview OTA** first; the owner smoke-tests on device (request → code email → reset → old session signed out → login by email).
4. The owner creates **support@ocrecipes.app** (mailbox or forward) before the production OTA.
5. Production OTA only on the owner's explicit yes.

A new client against an old server would 404 on the forgot-password endpoint, so the server ships first.

## 8. Risks

- **Auth breaks repeatedly in this codebase.** Mitigated by real-DB storage tests for the atomic predicates, and by testing revocation through the real `requireAuth`.
- **Email deliverability:** a reset depends entirely on Resend. With Resend unconfigured (local dev), no code is sent; that is intended, and codes are never logged as a fallback.
- **Residual timing difference on reset-password.** The attempt UPDATE writes a row only when the account has a live code; for any other email it matches zero rows. The difference is a single-row write (well under network jitter), it's observable only when a code is outstanding, and it's capped by the per-email limiter. Accepted; the security review should confirm.
- **In-memory limiters reset on deploy.** They now cover only the hourly and per-IP layers. The brute-force bound rests on the two **durable** caps (5 guesses per code, 6 codes per 24 h). Revisit if the server goes multi-instance.
- **Targeted recovery lockout (accepted).** Knowing only the victim's email, an attacker can (a) overwrite the victim's live code with each request, (b) use up the 6-per-24 h issuance cap, or (c) use up the 10 / 15 min reset limiter. Correction (auth audit 2026-10-10 L5): the lockout is **not** bounded at 24 h — see `docs/runbooks/password-reset-lockout.md`. The window is fixed from the first code and restarts, so an attacker who keeps going uses the cap up again each time it does; the victim is locked out of email recovery for as long as the attacker keeps it up, and receives every code email, so it's visible. Accepted: inherent to any issuance cap, which is what keeps brute force bounded.
- **Out-of-order code emails (accepted).** Two near-simultaneous requests can store A, store B, then send B, then send A, leaving the last-arriving email holding a dead code. Checking `RETURNING` doesn't help (each task always sees its own hash), and re-reading before the send only narrows the window. The 60 s client cooldown and the 3/hour limiter make this rare. The Reset screen's "use the most recent email" hint, and simply requesting again, recover from it.
