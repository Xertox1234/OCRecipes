# Sign in with Google and Sign in with Apple — Design

- **Date:** 2026-10-04
- **Todo:** `todos/P1-2026-09-26-sign-in-with-google-and-apple.md` (human-led, `security`)
- **Status:** the owner approved approach A and all five design sections in the brainstorming conversation on 2026-10-04. Awaiting the owner's review of this written spec.

## 1. Goal

A user can create an account or sign in with Google or with Apple instead of a password. Apple ships alongside Google because App Store Review Guideline 4.8 requires an equivalent privacy-preserving login whenever a third-party one (Google) is offered.

### Decisions (owner-approved 2026-10-04)

| Decision                                               | Choice                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overall approach                                       | **Native SDKs on the client; the server verifies the provider ID token** and issues our own JWT. No web redirect flow, no hosted auth vendor.                                                                                                                                                                                                                                                            |
| Username for a first-time social sign-up               | **The user picks one** on a new ChooseUsername screen (pre-filled with an editable suggestion).                                                                                                                                                                                                                                                                                                          |
| Can a social-only account get a password?              | **Yes, through the existing "Forgot password" flow.** No new screen.                                                                                                                                                                                                                                                                                                                                     |
| Linking an existing account the policy can't auto-link | **Inline "connect" prompt on the login flow AND a Profile → "Sign-in methods" screen.**                                                                                                                                                                                                                                                                                                                  |
| Google client library                                  | **SUPERSEDED 2026-10-09 → in-repo Expo module, see `2026-10-09-google-sign-in-native-module-design.md`.** Original choice: **the paid "Universal Sign In" edition** of `@react-native-google-signin/google-signin`. The free edition supports no nonce at all (`SignInParams.nonce` is "iOS only… Only available in the paid version") and is built on the deprecated legacy Android Google Sign-In SDK. |

### Settled earlier — not re-decided here (owner rulings 2026-09-26)

- Apple ships together with Google (guideline 4.8).
- Our own second factor still applies after a Google/Apple sign-in on an MFA-enabled account.
- An MFA-enabled account is never auto-linked.
- Apple tokens are revoked via Apple's REST API when an account is deleted.
- `security-auditor` review on every PR; never auto-merged.

### Conventions applied without a separate decision

- Disconnecting the **last** sign-in method is refused.
- Provider buttons appear only when the server reports that provider configured (§5.3), so code can merge before the owner's console setup is finished.
- **On iOS, Google is shown only when Apple is also available** (§5.3), so a partial configuration can never produce the Google-without-Apple screen that guideline 4.8 rejects.
- A user cancelling the Google/Apple sheet sees nothing (same as the IAP cancel rule, #1254).

### Out of scope

- MFA itself (P2 todo). This spec builds only the `requiresSecondFactor` hook point (§4.6).
- Google/Apple sign-in on web.
- Sign in with Apple on Android (guideline 4.8 binds the iOS app; Apple on Android needs a web flow).
- Changing a username after sign-up (existing behaviour unchanged).

## 2. User flows

1. **Returning user (provider already linked).** Tap "Continue with Apple/Google" → native sheet → signed in.
2. **New user.** Tap provider → sheet → **ChooseUsername** (suggestion pre-filled) → submit → onboarding, as after a password sign-up.
3. **Existing account, safely auto-linkable** (§4.3). Tap provider → sheet → signed in; the identity is now linked.
4. **Existing account, not auto-linkable.** Tap provider → sheet → **Connect prompt**: "You already have an OCRecipes account with this email." The prompt shows a password field + "Connect Google/Apple" if the account has a password; otherwise a "Continue with <its linked provider> to connect" button. It always also offers **"Forgot password?"** — the way out for an owner whose address was registered (unverified) by someone else, since a reset proves inbox control and verifies the email. Success → signed in and linked (after the second factor, once MFA exists).
5. **Profile → Sign-in methods.** Rows for Password ("Set" → Forgot password flow when there is none), Google, Apple — each Connect/Disconnect, showing the provider email or "Hidden by Apple". Disconnect disabled on the last method.
6. **Delete account.** Password if the account has one; otherwise "Confirm with Apple/Google" (fresh provider sign-in).

## 3. Data model (`shared/schema.ts`)

### 3.1 `users.password` becomes nullable

- A social-only account stores `NULL`. Never a sentinel or empty string.
- The inferred type becomes `string | null`. **Every reader of `user.password` is swept in PR 1** (§7); the type change turns each unhandled site into a compile error.
- Password login on a `NULL` password: run the existing `bcrypt.compare(input, DUMMY_PASSWORD_HASH)` and return the same 401 "Invalid credentials" (no timing or message difference).
- A password reset on a `NULL`-password account sets one. That is the owner's "add a password" path.
- A user created by a provider gets `emailVerified = true` (Google `email_verified === true`; Apple always asserts verified, relay addresses included).

### 3.2 New table `user_identities`

| column                       | type                    | notes                                                                     |
| ---------------------------- | ----------------------- | ------------------------------------------------------------------------- |
| `id`                         | varchar uuid PK         | `gen_random_uuid()`                                                       |
| `user_id`                    | varchar FK → `users.id` | **ON DELETE CASCADE**                                                     |
| `provider`                   | text                    | `'google' \| 'apple'` (check constraint)                                  |
| `provider_subject`           | text                    | the provider `sub`                                                        |
| `email`                      | text null               | address the provider reported — display only, **never used for matching** |
| `is_private_relay`           | boolean default false   | Apple Hide My Email                                                       |
| `apple_refresh_token_enc`    | text null               | AES-256-GCM ciphertext (§4.7); Apple only                                 |
| `created_at`, `last_used_at` | timestamptz             |                                                                           |

- **Unique (`provider`, `provider_subject`)** — one provider login belongs to exactly one account.
- **Unique (`user_id`, `provider`)** — at most one Google and one Apple per account.
- Index on `user_id`.

### 3.3 New table `auth_nonces`

| column       | notes                                                                                                                                                           |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nonce_hash` | text PK — SHA-256 hex of the raw nonce                                                                                                                          |
| `purpose`    | `'sign_in' \| 'link' \| 'reauth'`                                                                                                                               |
| `user_id`    | null for `sign_in`; the signed-in user for `link` issued under `requireAuth` and for `reauth` — checked at consume time so a nonce cannot move between accounts |
| `expires_at` | issue time + 10 minutes                                                                                                                                         |

Consumed by a single `DELETE FROM auth_nonces WHERE nonce_hash = $1 AND purpose = $2 AND expires_at > now() RETURNING *`. Zero rows ⇒ reject. Expired rows are swept on each issue.

### 3.4 New table `pending_social_sign_ins`

Holds a verified provider identity between "the provider said who you are" and "you have a session" (ChooseUsername, Connect prompt).

| column                                                      | notes                                                                                |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `ticket_hash`                                               | text PK — SHA-256 of a 32-byte random ticket; the raw ticket goes only to the client |
| `kind`                                                      | `'sign_up' \| 'link'`                                                                |
| `provider`, `provider_subject`, `email`, `is_private_relay` | from the verified token                                                              |
| `display_name`                                              | Apple first-authorization name, or Google `name`                                     |
| `apple_refresh_token_enc`                                   | when the Apple code exchange has already run                                         |
| `target_user_id`                                            | `link` kind only — FK → users ON DELETE CASCADE                                      |
| `expires_at`                                                | issue time + 15 minutes                                                              |

Consumed with the same atomic `DELETE … RETURNING` as nonces; single use.

### 3.5 New env vars

| var                                                                  | purpose                                                                                                                              |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `IDENTITY_TOKEN_ENC_KEY`                                             | 32-byte base64 key for §4.7. **Not derived from `JWT_SECRET`**: rotating `JWT_SECRET` must not make stored Apple tokens unrevocable. |
| `GOOGLE_OAUTH_WEB_CLIENT_ID`                                         | the required Google ID-token `aud`                                                                                                   |
| `GOOGLE_OAUTH_APP_CLIENT_IDS`                                        | comma-separated iOS + Android client IDs — the allowed `azp`                                                                         |
| `APPLE_TEAM_ID`, `APPLE_SIGN_IN_KEY_ID`, `APPLE_SIGN_IN_PRIVATE_KEY` | Sign in with Apple key (separate from the IAP key) for the client-secret JWT                                                         |
| `APPLE_BUNDLE_ID`                                                    | already exists (IAP); reused as Apple `aud` and REST `client_id`                                                                     |

Provider "configured" = all of its vars present and well-formed; validated at boot via `server/lib/env.ts` (a malformed value fails boot; an absent provider is simply disabled).

## 4. Server

New files (`server/routes/auth.ts` is already 973 lines):

- `server/routes/auth-social.ts` — the endpoints below, registered via the routes index.
- `server/lib/social-identity/verify-google.ts`, `verify-apple.ts`, `apple-tokens.ts` (code exchange + revoke), `token-crypto.ts`, `linking-policy.ts`.
- `server/storage/identities.ts` — identities, nonces, pending tickets.

### 4.1 Token verification

Common: signature against the provider JWKS (cached, with key rotation), `iss`, `aud`, `exp` (no leeway beyond 60 s), and `nonce`.

- **Nonce binding.** The client receives `{nonce, nonceHash}` from §4.2 and passes **`nonceHash`** to both SDKs; it sends the raw `nonce` back. The server requires `token.nonce === sha256hex(nonce)`, then consumes the nonce row for the expected purpose. Both checks must pass.
- **Google** — `google-auth-library` (already a dependency) `OAuth2Client.verifyIdToken`. `iss ∈ {accounts.google.com, https://accounts.google.com}`. **`aud === GOOGLE_OAUTH_WEB_CLIENT_ID`** (the app configures `webClientId`, so Google issues tokens for the web/server client) and **`azp ∈ GOOGLE_OAUTH_APP_CLIENT_IDS`**.
- **Apple** — `jose` `createRemoteJWKSet('https://appleid.apple.com/auth/keys')` + `jwtVerify`. `iss === 'https://appleid.apple.com'`, **`aud === APPLE_BUNDLE_ID`**. `email_verified` / `is_private_email` may arrive as the strings `"true"`/`"false"`; normalise.
- **Apple nonce passthrough verified (2026-10-04):** `expo-apple-authentication` assigns `request.nonce = options.nonce` with no hashing (`ios/AppleAuthenticationRequest.swift`), so the token's `nonce` claim is exactly the `nonceHash` the client passed.
- **Missing or empty `email` claim** → 400 `PROVIDER_EMAIL_REQUIRED` (users.email is NOT NULL); never a 500.
- The verified result is a typed `ProviderClaims { provider, sub, email, emailVerified, hostedDomain?, isPrivateRelay, name? }`. Nothing downstream reads raw token fields.

### 4.2 Endpoints

| endpoint                                 | auth                                                                                                          | body                                                             | result                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------- |
| `GET /api/auth/social/config`            | public                                                                                                        | —                                                                | `{google: boolean, apple: boolean}` |
| `POST /api/auth/social/nonce`            | public for `sign_in`; optional auth for `link` (bound to the user when signed in); `requireAuth` for `reauth` | `{purpose}`                                                      | `{nonce, nonceHash}`                |
| `POST /api/auth/social`                  | public                                                                                                        | `{provider, idToken, nonce, authorizationCode?, fullName?}`      | one of the four outcomes in §4.3    |
| `POST /api/auth/social/complete-sign-up` | public                                                                                                        | `{ticket, username}`                                             | session                             |
| `POST /api/auth/social/link`             | public                                                                                                        | `{ticket, password}` **or** `{ticket, provider, idToken, nonce}` | session                             |
| `POST /api/auth/identities`              | `requireAuth`                                                                                                 | `{provider, idToken, nonce, authorizationCode?}`                 | updated `signInMethods`             |
| `DELETE /api/auth/identities/:provider`  | `requireAuth`                                                                                                 | —                                                                | updated `signInMethods`             |

Changed: `GET /api/auth/me` adds `signInMethods: {password: boolean, google: {email} | null, apple: {email, isPrivateRelay} | null}`. `DELETE /api/auth/account` — §4.8.

Rate limits: a new per-IP `socialAuthLimiter` on the public endpoints; `/social/link` with a password also applies the existing per-account login limiter keyed on `target_user_id`, since it is a password-guessing surface.

### 4.3 Linking policy (`linking-policy.ts`) — pure function

Input: the verified `ProviderClaims`, the user (if any) already owning `(provider, sub)`, the user (if any) whose **verified** `email` equals the claim email case-insensitively (never `pendingEmail`), that user's MFA state and existing sign-in methods. Output, in this precedence:

1. `(provider, sub)` already linked → **`sign_in`** that user.
2. No user has this email → **`choose_username`** (ticket kind `sign_up`).
3. A user has this email **and** all of: no MFA; the provider is **authoritative** for the address; the account's `emailVerified` is true → **`auto_link`** then sign in.
4. Otherwise → **`link_required`** (ticket kind `link`, `target_user_id`), response includes the account's existing methods, e.g. `["password"]` or `["apple"]`.

**Authoritative:**

- Addresses are lowercased and trimmed before any comparison.
- Google: the address ends in `@gmail.com` (`@googlemail.com` is treated the same — Google's legacy alias for the same mailboxes), **or** `email_verified === true` and `hd` is set (Workspace). Any other Google address is not authoritative ("ownership of the third party email account may have since changed").
- Apple: `email_verified` true and **not** a private relay. A relay address never matches an existing account (it reaches rule 2 or, if somehow equal, rule 4).

An email match on an account that is not `emailVerified` goes to rule 4, never rule 3. "Link required" reveals that an address is registered — only to a caller who just presented a valid provider token for that address. Accepted in the todo.

### 4.4 Completing sign-up and linking

- **`complete-sign-up`** — validates `username` with the existing register rules **and requires `ageConfirmed: true`** (the same COPPA 13+ attestation `registerSchema` enforces with `z.literal(true)`), then **in one transaction**: consume the ticket, insert the user (`password NULL`, `email` from the ticket, `emailVerified true`, `displayName`), insert the identity. A unique violation on `username` or `users_email_lower_unique` → 409 with the existing error codes, never 500. A suggestion for the pre-fill comes from the `choose_username` response (name-derived, collision-checked, not reserved).
- **`link` with password** — consume the ticket, `bcrypt.compare` against the target user's password (dummy compare + 401 when `NULL`), then `finishSignIn`.
- **`link` with provider** — consume the ticket, verify the second provider token (nonce purpose `link`), require it to be **already linked to `target_user_id`**, then `finishSignIn`.
- **The identity is inserted only when `finishSignIn` issues a real session** — i.e. after the second factor (once MFA exists) and after the `EMAIL_NOT_VERIFIED` gate. If `finishSignIn` returns the MFA challenge, the pending identity rides with the challenge and is inserted only when the challenge passes. A password alone can never attach a provider to an MFA account.
- If the identity's provider is authoritative for exactly the account's address, linking also sets `emailVerified = true`. Otherwise the existing `EMAIL_NOT_VERIFIED` gate applies at sign-in exactly as for password login.

### 4.5 Connect / disconnect (signed in)

- `POST /api/auth/identities` — verify (nonce purpose `link`, bound to `req.userId`). If `(provider, sub)` is linked to another account → **409 "This Google account is already used by another OCRecipes account."** Never moved silently. If this account already has that provider → **409 `PROVIDER_ALREADY_CONNECTED`**, never a unique-violation 500. Apple code exchange per §4.7.
- `DELETE /api/auth/identities/:provider` — refused with 409 when it would leave no method (no password and no other identity). For Apple, revoke the stored token first (failure logged, does not block).

### 4.6 `finishSignIn(user)` — the single sign-in exit

Every successful social path ends here. If `requiresSecondFactor(user)` (returns `false` until MFA ships) → **until MFA ships there is no challenge token to issue, so the route responds 403 `SECOND_FACTOR_REQUIRED` with no token and inserts no identity**; the MFA todo replaces that branch with its challenge token and the deferred identity insert; otherwise `generateToken(user.id, user.tokenVersion, user.emailVerified)` + `serializeUser(user)` — identical to password login. Updates `last_used_at`.

### 4.7 Apple code exchange, token storage, revoke (`apple-tokens.ts`)

- **Exchange:** when a request carries `authorizationCode` and the identity has no stored refresh token, `POST https://appleid.apple.com/auth/token` (`grant_type=authorization_code`, `client_id=APPLE_BUNDLE_ID`, `client_secret` = ES256 JWT `{iss: TEAM_ID, sub: BUNDLE_ID, aud: 'https://appleid.apple.com', exp ≤ 5 min}` signed with the Sign in with Apple key).
- **On a first Apple sign-in, an exchange failure fails the sign-in** (retryable error) — we never create an account we cannot later revoke. On a repeat sign-in with a token already stored, no exchange.
- **Storage:** `token-crypto.ts` — AES-256-GCM, random 12-byte IV, stored as `v1:<iv>:<tag>:<ciphertext>` base64.
- **Revoke:** `POST https://appleid.apple.com/auth/revoke` with `token_type_hint=refresh_token`, 5 s timeout.

### 4.8 Account deletion

`DELETE /api/auth/account` accepts **`{password}` or `{provider, idToken, nonce}`** (nonce purpose `reauth`; the token's `(provider, sub)` must be linked to `req.userId`). Then:

1. Load the account's Apple refresh tokens and **revoke them before deleting** (timeout per §4.7). **A revoke failure does not block deletion** — logged and sent to Sentry.
2. Existing behaviour unchanged: collect image URLs, `deleteUser` (cascades `user_identities`), invalidate the `tokenVersion` cache, fire-and-forget image cleanup.

## 5. Client

### 5.1 Dependencies and native config

- `expo-apple-authentication` via `npx expo install`; the Universal Sign In package from its private registry (registry token in `.npmrc` via env, never committed).
- No client-side hashing — the server supplies `nonceHash` (Hermes has no global `crypto`).
- Hand edits (committed `ios/`/`android/`, no prebuild): `ios/OCRecipes/OCRecipes.entitlements` gains `com.apple.developer.applesignin = ["Default"]`; `Info.plist` gains Google's reversed iOS client ID URL scheme; Android adds nothing beyond autolinking. The plugin entries also go in `app.json` so config stays truthful.
- ~~Build-time env: `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`, `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`.~~ **SUPERSEDED 2026-10-09:** committed constants in `client/constants/google-oauth.ts` — see `2026-10-09-google-sign-in-native-module-design.md` §3.4.
- **PR 4 bumps `runtimeVersion` (1.3.0 → 1.4.0).** Importing the native modules throws at module load on a binary that lacks them, before any button can be hidden — so without the bump, a later OTA would crash the pending 1.3.0 build. Requires a new native build; not deliverable by OTA to earlier builds.

### 5.2 Screens

- **LoginScreen** — above the existing form: Apple's native `AppleAuthenticationButton` ("Continue with Apple", iOS only) on top, Google-branded "Continue with Google" below at the same size (Apple at least as prominent, per Apple's HIG), then an "or" divider.
- **ChooseUsernameScreen** (new) — one field pre-filled with the suggestion, the same 13+ age checkbox as registration, existing username validation and 409 feedback; success → onboarding.
- **Connect prompt** (new) — on `link_required`, per §2 flow 4.
- **SignInMethodsScreen** (new, from Profile) — per §2 flow 5.
- **Delete account** — branches on `signInMethods` per §2 flow 6.

All successful sign-ins go through the existing login-success path (token stored in the Keychain, #1249–#1251).

### 5.3 Visibility

The client calls `GET /api/auth/social/config`; a button renders only when its flag is true **and** the platform supports it (Apple: iOS only). **On iOS, Google renders only when `apple` is also true** (guideline 4.8); the rule lives in a pure util with its own test. The buttons stay hidden until the owner's Railway env lands, with no new build needed.

### 5.4 Testable logic

Outcome → navigation mapping and the "can disconnect" rule live in pure `*-utils.ts` files with Vitest coverage.

## 6. Testing (TDD — tests first in each PR)

- **Verification** — real keys generated with `jose` in-test, served through a stubbed JWKS: bad signature, wrong `iss`, wrong `aud`, `azp` not ours (Google), expired, nonce mismatch, nonce reused, nonce expired, nonce of the wrong purpose, string-typed Apple booleans.
- **`linking-policy.ts`** — table-driven: MFA on/off × gmail / Workspace `hd` / other domain × `email_verified` × relay × account `emailVerified` × email-only-in-`pendingEmail` × identity already linked. Each named rule in the todo is its own row.
- **Routes, with the real `requireAuth`** (not mocked): all four `/social` outcomes; ticket single-use + expiry; concurrent same-username `complete-sign-up` → one 201, one 409, no 500; first vs repeat Apple payload (name persisted once); Apple exchange failure fails a first sign-in; `NULL`-password login → 401 with the dummy compare; last-method disconnect refused; identity owned by another account → 409; deletion by provider re-auth; revoke called before delete; deletion succeeds when revoke fails; `signInMethods` on `/me`.
- **MFA gate** — with `requiresSecondFactor` forced true, a provider sign-in returns 403 `SECOND_FACTOR_REQUIRED` with **no token** (the MFA todo upgrades this to a challenge token); and **no `user_identities` row exists after `/social/link`** until the challenge passes.
- **Nonce binding** — a `reauth` nonce issued to user A is rejected for user B; a public `link` nonce works for the unauthenticated Connect prompt.
- **Edge responses** — missing email claim → 400; connecting an already-connected provider → 409; `@GMAIL.COM` / `@googlemail.com` treated as authoritative.
- **Visibility util** — iOS with `{google: true, apple: false}` shows neither button.
- **`token-crypto.ts`** — round-trip; tampered tag rejected; wrong key rejected.
- **Client** — utils unit tests; `/verify-ui` on ChooseUsername, Connect prompt, SignInMethods. Real Google/Apple sheets: one owner smoke test on device (§7).

## 7. Rollout

Five stacked PRs. Each is `human_led`, reviewed by `security-auditor` + `code-reviewer`, never auto-merged. Nothing is user-visible until the server env is set.

1. **Schema + storage** — nullable `password` + the reader sweep, the three tables, `token-crypto.ts`, `identities.ts`.
2. **Server sign-in** — verification, linking policy, `config`/`nonce`/`social`/`complete-sign-up`/`link`, `finishSignIn`, env validation.
3. **Server lifecycle** — connect/disconnect, `signInMethods`, deletion re-auth + Apple revoke.
4. **Client sign-in** — `runtimeVersion` bump to 1.4.0, deps, native config, Login buttons, ChooseUsername, Connect prompt. Blocked until the registry token is on Railway, EAS and CI.
5. **Client settings** — SignInMethods screen, deletion confirmed by provider.

### Owner checklist

- **Apple:** ~~enable Sign in with Apple on `com.ocrecipes.app`~~ (done 2026-10-04); create a Sign in with Apple key (.p8) → `APPLE_TEAM_ID`, `APPLE_SIGN_IN_KEY_ID`, `APPLE_SIGN_IN_PRIVATE_KEY`; register `ocrecipes.com` and the sender address in "Sign in with Apple for Email Communication" (needs SPF on the domain) so reset codes reach relay users.
- **Developer account:** add an auto-renew card (portal banner, 2026-10-04).
- **Google Cloud:** OAuth consent screen; Web, iOS, and Android client IDs (Android: debug, upload, and Play App Signing SHA-1s).
- **Universal Sign In:** license (or the EAS form). The registry token is needed **everywhere `npm install` runs on the root `package.json`**: EAS (secret), GitHub Actions (secret), **Railway** (its Railpack build installs the same root `package.json` — the server deploy fails without it), local checkouts and worktrees (`.npmrc` reading an env var), and Dependabot (registry credential). Must be in place before PR 4 merges.
- **Railway:** `IDENTITY_TOKEN_ENC_KEY` (`openssl rand -base64 32`), the Google and Apple vars from §3.5.
- **Then:** 1.4.0 native build; device smoke — new Apple account, Apple Hide My Email, Google Gmail auto-link to the owner account, delete an Apple test account (confirm the app disappears from Settings → Apple ID → Sign in with Apple).

## 8. Risks

- **Unsafe auto-linking is an account-takeover path.** Mitigated by the pure policy + its table test; the verified-email and authoritative-provider rules are mandatory.
- **Losing the encryption key** makes stored Apple tokens unrevocable. The key is independent of `JWT_SECRET` and must be backed up with the other Railway secrets.
- **Paid library dependency** — CI and EAS builds fail without the registry token; the license is a recurring cost.
- **Untested Android path** — built, not device-tested (owner has Apple hardware only).
- **New native build required**; the current preview build cannot get this by OTA.
