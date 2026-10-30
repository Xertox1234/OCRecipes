---
title: "Google sign-in: owner checks after build 8 (device checklist, publish the OAuth app, Android)"
status: done
priority: medium
created: 2026-10-10
updated: 2026-10-29
assignee:
labels: [deferred, auth, react-native]
github_issue:
human_led: true
---

# Google sign-in: owner checks after build 8 (device checklist, publish the OAuth app, Android)

## Summary

Google sign-in is merged (#1351, `903c8e48`) and build 8 (runtime 1.5.0) is on its way to TestFlight. What is left needs the owner's phone, Google Cloud console or an Android device, so no agent can do it.

## Background

Carried over from `todos/archive/P1-2026-09-26-sign-in-with-google-and-apple.md`, closed 2026-10-10 once the code shipped. The checks below are the unticked list from the PR #1351 body.

## Acceptance Criteria

- [ ] **Before App Review or external TestFlight testers: publish the Google OAuth app** (Google Cloud → Google Auth Platform → Audience → Publish app). In Testing mode Google blocks everyone not on the test-user list, including Apple's reviewers. Branding first: home page `https://ocrecipes.com`, privacy `https://ocrecipes.com/privacy`, terms `https://ocrecipes.com/terms`, authorised domain `ocrecipes.com`. Scopes are openid/email/profile only, so Google verification is not needed (a logo may trigger brand verification).
- [x] **On iPhone with build 8:** (owner 2026-10-29: Google sign-in has worked on iOS for a long time)
  - [x] Sign up with Google.
  - [x] Sign out and sign in again with Google.
  - [ ] Connect Google to an existing password account (Settings → Sign-in methods).
  - [ ] Disconnect it.
  - [ ] Delete a Google-only account (Google re-auth).
  - [ ] Cancel the sheet: nothing is shown.
  - [ ] After publishing, sign in with a Google account that is not a test user.
- [x] **Android device test** when convenient (deferred by the owner; Apple-only hardware today). On the first real sign-in, watch the server logs: a "nonce mismatch" means the client must change, not the server check.
- [ ] One throwaway local build with a wrong `Info.plist` URL scheme: tapping Google shows the error message and the app stays open.

## Implementation Notes

- Build 8: EAS build `092678fc-eb67-4baf-acb6-1c2a23d9e7e3`, TestFlight submission `2b31f374-92e9-465b-b652-a319e66e4286`.
- Client IDs: `client/constants/google-oauth.ts`. Server checks: `/api/auth/social` (nonce, audience, authorised party).
- A defect found during these checks gets a fix PR (roll forward), not a revert.

## Dependencies

- Build 8 installed from TestFlight.

## Risks

- Submitting to App Review before publishing the OAuth app means a rejection.

## Updates

### 2026-10-10

- Created when the P1 sign-in todo was closed.

### 2026-10-29

- Closed. The owner confirmed that Google sign-in has worked on iOS for a long time.
- Android passed on the EAS preview build: `POST /api/auth/social 200` at 22:47Z, against the live server. The build needed its own Android OAuth client, plus that client ID in `GOOGLE_OAUTH_APP_CLIENT_IDS` on Railway. Without the Railway entry the server returned a 401 (`azp` check).
- Not done as separate checks; no fault has been reported: connect, disconnect, delete Google-only, cancel the sheet.
- Dropped: the throwaway wrong-`Info.plist` build. The owner tests on live-server preview builds only, not local builds.
- Moved to the launch-prep checklist: publishing the Google OAuth app, then signing in with a Google account that is not a test user. It is still required before App Review.
