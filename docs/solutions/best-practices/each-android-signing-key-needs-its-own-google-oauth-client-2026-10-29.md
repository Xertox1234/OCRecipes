---
title: "Each Android signing key needs its own Google OAuth Android client AND an entry in GOOGLE_OAUTH_APP_CLIENT_IDS — or sign-in fails with 401"
track: knowledge
category: best-practices
tags: [security, api]
module: server
applies_to: ["server/lib/social-identity/**/*.ts", "client/constants/google-oauth.ts"]
symptoms: ["Google sheet completes on Android but POST /api/auth/social returns 401", "Works on iOS and on a differently signed Android build"]
created: 2026-10-29
---

# Each Android signing key needs its own Google OAuth Android client AND an entry in GOOGLE_OAUTH_APP_CLIENT_IDS — or sign-in fails with 401

## When this applies

Any time the Android app is signed with a key that hasn't signed in with Google before: the first EAS preview build, a new upload key, and the Play app-signing key at launch (Play re-signs the app, so store installs have a different SHA-1 from EAS builds).

## Rule

For each signing key:

1. In Google Cloud (project `ocrecipes`) → Credentials, create an **Android** OAuth client with package `com.ocrecipes.app` and that key's SHA-1. Read the SHA-1 from the build (`keytool -printcert -jarfile app.apk`) or from Play Console → App signing.
2. Add the new client ID to **`GOOGLE_OAUTH_APP_CLIENT_IDS`** on Railway (comma-separated) and redeploy.

## Why

Google issues the ID token with `azp` set to the Android client that matched the app's package and SHA-1. `server/lib/social-identity/verify.ts` accepts a token only when its `azp` is in `GOOGLE_OAUTH_APP_CLIENT_IDS`. If step 1 is missing, the Google sheet itself fails. If step 2 is missing, the sheet succeeds and the server returns 401. That second case looks like a server bug, but the check is correct and shouldn't be loosened.

## Examples

- 2026-10-29: the Android EAS preview build (SHA-1 `C1:82:6B:…:82:4F`) got 401s until client `302305066915-cpkt4l482sg56l8bvthtfcepv0aq8qd7` was added to the Railway list. The next attempt returned `POST /api/auth/social 200`.

## Exceptions

- iOS uses its own single iOS client and isn't affected by Android signing keys.
- While the consent screen is in Testing mode, only listed test users can sign in. Publishing the OAuth app is a separate launch-prep step.

## Related Files

- `server/lib/social-identity/verify.ts` (audience and `azp` checks), `server/lib/social-identity/config.ts` (reads `GOOGLE_OAUTH_APP_CLIENT_IDS`)
- `client/constants/google-oauth.ts`
