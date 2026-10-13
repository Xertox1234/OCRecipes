# Google Sign-In via an in-repo Expo module — Design

- **Date:** 2026-10-09
- **Todo:** `todos/P1-2026-09-26-sign-in-with-google-and-apple.md` (Google half)
- **Supersedes:** the "Google client library" row of `docs/superpowers/specs/2026-10-04-sign-in-with-google-and-apple-design.md` §1 (the paid Universal Sign In edition). Everything else in that spec still stands — server, nonce flow, linking rules, data model.

## 1. Decision

The owner declined the paid Universal Sign In licence (2026-10-09). We build our own small Expo module that calls Google's official SDKs directly:

- **iOS:** `GoogleSignIn` (google/GoogleSignIn-iOS) — `signInWithPresentingViewController:hint:additionalScopes:nonce:completion:`.
- **Android:** Credential Manager (`androidx.credentials`) + `googleid` — `GetSignInWithGoogleOption.Builder(serverClientId).setNonce(...)`.

Rejected: the free edition of `@react-native-google-signin/google-signin` (no nonce; legacy Android SDK); forking it (large inherited surface, same legacy Android SDK); a bare TurboModule (more boilerplate than the Expo Modules API the app already uses).

Owner rulings (2026-10-09): build iOS and Android together; Android device testing is deferred (emulator only for now).

## 2. What already exists (unchanged)

- Server: `server/routes/auth-social.ts` + `verifyGoogleIdToken` in `server/lib/social-identity/verify.ts` verify the Google ID token — `aud === GOOGLE_OAUTH_WEB_CLIENT_ID`, `azp ∈ GOOGLE_OAUTH_APP_CLIENT_IDS`, and `token.nonce === sha256hex(rawNonce)` with a single-use nonce row. `GET /api/auth/social/config` already reports `google: true` when both vars are set.
- Client: `client/lib/social-sign-in.ts` (`getProviderToken`, `NATIVE_PROVIDERS`), `client/components/SocialSignInButtons.tsx` (shows a button only when server config **and** `NATIVE_PROVIDERS` agree), Connect/ChooseUsername screens.

**Token shape both SDKs produce:** with the web client ID passed as the server client ID (`GIDConfiguration.serverClientID` on iOS, `serverClientId` on Android), Google issues an ID token whose `aud` is the web client ID and whose `azp` is the platform's app client ID — exactly what `verifyGoogleIdToken` checks. No server change.

## 3. The module — `modules/google-sign-in/`

Expo autolinking picks up local modules under `modules/` with no extra config; `pod install` and Gradle pick it up in the committed `ios/`/`android/` projects.

### 3.1 JS surface (`modules/google-sign-in/index.ts`)

```ts
export interface GoogleSignInResult {
  idToken: string;
  email: string | null;
}
export type GoogleSignInErrorCode =
  | "NO_ACCOUNT" // no Google account on device / none chosen to add
  | "PLAY_SERVICES" // Android: Play services missing or outdated
  | "NOT_CONFIGURED" // client IDs missing
  | "FAILED"; // anything else
/** Resolves null on user cancel; rejects with { code: GoogleSignInErrorCode }. */
export function signIn(opts: {
  webClientId: string;
  iosClientId?: string; // required on iOS
  nonce: string; // passed through verbatim — callers pass the server's nonceHash
}): Promise<GoogleSignInResult | null>;
```

One function. No sign-out, no silent sign-in, no scopes, no profile beyond email — our session is our own JWT; Google is only used to obtain one verified ID token.

### 3.2 iOS (`ios/GoogleSignInModule.swift`, podspec)

- Podspec depends on `GoogleSignIn` — pin the newest release at implementation time and confirm its public header still has the `nonce:` sign-in method.
- **URL-scheme guard first:** GoogleSignIn raises an Objective-C `NSException` (uncatchable in Swift — the app closes) when the reversed client ID is missing from `CFBundleURLTypes`. Before touching `GIDSignIn`, read `Bundle.main.infoDictionary["CFBundleURLTypes"]`, and if no entry's `CFBundleURLSchemes` contains the reversed `iosClientId` (`com.googleusercontent.apps.<prefix>` from `<prefix>.apps.googleusercontent.com`), reject with `NOT_CONFIGURED`. Same rejection when `iosClientId` is absent or empty.
- `signIn`: build `GIDConfiguration(clientID: iosClientId, serverClientID: webClientId)`, set it on `GIDSignIn.sharedInstance`, then call `signIn(withPresenting:hint:nil, additionalScopes:nil, nonce:)` on the main queue with the current top view controller.
- Result: `user.idToken.tokenString` + `user.profile?.email`. Cancel → `GIDSignInError.canceled` → resolve `null`.
- **URL callback:** an `ExpoAppDelegateSubscriber` in the module forwards `application(_:open:options:)` to `GIDSignIn.sharedInstance.handle(url)`. No edit to `AppDelegate`.
- Call `GIDSignIn.sharedInstance.signOut()` after extracting the token so the next tap shows the account picker instead of silently reusing the last account.

### 3.3 Android (`android/.../GoogleSignInModule.kt`, `build.gradle`)

- Dependencies: `androidx.credentials:credentials`, `androidx.credentials:credentials-play-services-auth`, `com.google.android.libraries.identity.googleid:googleid` — latest **stable** versions at implementation time (the Android guide currently shows alphas; do not ship an alpha).
- `signIn`: `GetSignInWithGoogleOption.Builder(webClientId).setNonce(nonce).build()` → `CredentialManager.create(activity).getCredential(activity, request)` in a coroutine on the module's scope, using `appContext.currentActivity`.
- Result: `CustomCredential` of type `GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL` → `GoogleIdTokenCredential.createFrom(data)` → `idToken`, `id` (the email).
- Errors: `GetCredentialCancellationException` → resolve `null`; `NoCredentialException` → `NO_ACCOUNT`; Play-services provider errors → `PLAY_SERVICES`; anything else → `FAILED`.
- After success, `clearCredentialState` so the next tap shows the picker.

### 3.4 Client wiring (`client/lib/social-sign-in.ts`)

- **Client IDs are committed constants, not env vars.** New file `client/constants/google-oauth.ts` exports `GOOGLE_WEB_CLIENT_ID` and `GOOGLE_IOS_CLIENT_ID` (empty strings until owner step §6, then the real values). OAuth client IDs are public identifiers, not secrets — the reversed iOS one is committed to `Info.plist` anyway. Constants mean nothing has to be threaded through `eas.json` profiles or the `update:*` scripts (which inline only `EXPO_PUBLIC_DOMAIN` / `EXPO_PUBLIC_SENTRY_DSN`); a missed `EXPO_PUBLIC_*` there would inline `undefined` and silently hide the button in TestFlight and after every OTA. This supersedes the parent spec's "Build-time env" line (§5.1). The Android client ID never appears in the client — Credential Manager matches it by package + SHA-1.
- Import the module by relative path (`../../modules/google-sign-in`); no new alias. Vitest mocks it the same way existing tests mock `requireNativeModule`-at-load modules (precedent: `client/camera/utils/__tests__/recognizeTextFromPhoto.test.ts`).
- Google branch of `getProviderToken`: call `signIn({ webClientId: GOOGLE_WEB_CLIENT_ID, iosClientId: GOOGLE_IOS_CLIENT_ID, nonce: nonceHash })`, map to `ProviderToken { idToken }`; `null` passes through as cancel.
- `NATIVE_PROVIDERS.google` = true only when `GOOGLE_WEB_CLIENT_ID` is non-empty and, on iOS, `GOOGLE_IOS_CLIENT_ID` is non-empty. Empty ⇒ the button stays hidden (existing visibility rule).
- **Error copy: no new string.** A native rejection is not an `ApiError`, so `socialSignInErrorMessage` (`client/lib/social-auth-utils.ts`) already maps it to its default, "Sign-in didn't work. Please try again." — that stays the single source of sign-in error copy. (Do not suggest "use your password": a Google-created account has `password NULL`.) The rejection is reported through the existing client reporter — `reportError(err, \`google-sign-in:${code}\`)`from`client/lib/reporter.ts`(it owns Sentry init and event scrubbing; don't call Sentry directly) — at the`getProviderToken`catch, then rethrown;`NO_ACCOUNT`/`NOT_CONFIGURED`/`PLAY_SERVICES`/`FAILED` never reach the UI.

### 3.5 Native project hand edits (no prebuild)

- `ios/OCRecipes/Info.plist`: add the **reversed `GOOGLE_IOS_CLIENT_ID`** as a `CFBundleURLSchemes` entry (needs the real iOS client ID — owner step §6 comes first). The plist and the constant are two committed copies of one value; the §5 Vitest drift check keeps them in step.
- Android: nothing beyond autolinking and the module's own Gradle deps.
- `app.json`: no plugin entry needed (no config plugin; the plist edit is hand-made and noted in a comment in this spec's PR).

## 4. Release

- **Bump `runtimeVersion` 1.4.0 → 1.5.0.** JS that imports the module would throw on a 1.4.0 binary that lacks it, so the new JS must not reach 1.4.0 builds by OTA.
- Needs a new native build (iOS via TestFlight). No CI job builds Android, and the only iOS build in CI is the nightly, non-blocking `e2e-regression.yml` — native compilation is proven by the manual builds in §5, not by CI. Android device test deferred.

## 5. Testing

- **Vitest** (`client/lib/__tests__/social-sign-in.test.ts`, module mocked): Google branch passes `nonceHash` through unchanged as `nonce`; passes both client IDs; `null` → cancel; a rejection propagates with its code; `NATIVE_PROVIDERS.google` false when the client-ID constants are empty (and on iOS when only the web ID is set); a rejection is reported to Sentry with its code and the UI copy comes from `socialSignInErrorMessage`'s default.
- **Vitest drift check:** when `GOOGLE_IOS_CLIENT_ID` is non-empty, `ios/OCRecipes/Info.plist` contains its reversed form in `CFBundleURLSchemes` — a mismatch fails the suite instead of reaching a device.
- **Build (manual, before the PR opens — CI does not build either native project on PRs):** `npx expo run:ios` (or `xcodebuild` on `ios/OCRecipes.xcworkspace`) and `cd android && ./gradlew assembleDebug`, both green with the module linked; then one manual `workflow_dispatch` of `e2e-regression.yml` on the branch. Record each result in the PR body.
- **Device (owner, iPhone):** sign up with Google, sign in again, connect Google to an existing account, disconnect, delete account via Google re-auth; cancel shows nothing. Plus one build whose plist scheme does not match `GOOGLE_IOS_CLIENT_ID` (a throwaway local build): tapping Google shows the error message and the app stays open (URL-scheme guard, §3.2).
- **Android emulator (me):** the sheet opens and returns a token that the server accepts. Real-device test deferred.
- **First-device check that closes the one unverified assumption:** both SDKs put the passed nonce into the token's `nonce` claim verbatim (Apple's does; Google's docs show the value passed straight through but don't state it). If the server rejects with a nonce mismatch, decode the token and adjust the client — not the server's check.

## 6. Owner steps (free, before the button can work)

In Google Cloud Console → APIs & Services:

1. **OAuth consent screen:** app name OCRecipes, support email, `ocrecipes.com` as authorised domain, privacy-policy URL; scopes `openid`, `email`, `profile` only.
2. **Credentials → Create OAuth client ID**, three times:
   - **Web application** — no redirect URIs needed. → Railway `GOOGLE_OAUTH_WEB_CLIENT_ID` and the committed constant `GOOGLE_WEB_CLIENT_ID` (`client/constants/google-oauth.ts`).
   - **iOS** — bundle ID `com.williamtower.ocrecipes`. → the committed constant `GOOGLE_IOS_CLIENT_ID`; its reversed form goes in `Info.plist` (§3.5).
   - **Android** — package `com.ocrecipes.app` + SHA-1 of the debug keystore now; add the upload and Play App Signing SHA-1s when Android ships.
3. Railway `GOOGLE_OAUTH_APP_CLIENT_IDS` = `<iOS client ID>,<Android client ID>`.

## 7. Out of scope

Google sign-in on web; any server change; silent/one-tap auto sign-in; extra Google scopes or API access.

## 8. Risks

- **Nonce passthrough unverified on device** — §5 check; fix is client-side.
- **Android untested on a real phone** — emulator only until the owner tests.
- **We own the native code** — SDK upgrades are ours to do; the surface is one function per platform to keep that cheap.
