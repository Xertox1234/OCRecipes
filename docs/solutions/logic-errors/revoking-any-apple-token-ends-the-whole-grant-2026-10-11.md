---
title: "Revoking any Sign in with Apple token ends the app's whole grant — revoke an unstored token only when no identity or live ticket holds that Apple ID"
track: bug
category: logic-errors
tags: [security, api]
module: server
applies_to: ["server/routes/auth-social.ts", "server/routes/auth.ts", "server/storage/identities.ts"]
symptoms: ["OCRecipes stays under 'Apps using Apple ID' after a failed sign-in or an account deletion", "A pending Apple sign-up completes with a dead refresh token after a retry failed"]
created: 2026-10-11
severity: low
---

# Revoking any Sign in with Apple token ends the app's whole grant — revoke an unstored token only when no identity or live ticket holds that Apple ID

## Problem

Auth audit 2026-10-10 L17. Apple refresh tokens exchanged during sign-in/connect were dropped unrevoked when the request then failed, and link tickets aimed at a deleted account cascaded away with their tokens — leaving OCRecipes under "Apps using Apple ID" (App Store 5.1.1(v); Apple TN3194: `/auth/revoke` is the only programmatic invalidation).

The first fix revoked any unstored token unless the Apple ID was linked — but revoking ANY token for an Apple ID ends the app's whole grant, so a failed retry killed the token a still-live sign-up ticket held (caught in review).

## Root Cause

Apple authorization is per (user, app), not per token.

## Solution

`storage.appleGrantInUse(sub)` — a linked identity OR a live ticket holds the Apple ID (the expiry sweep's own rule). The sign-in handler tracks the exchanged token as `unstored` until a store point (`setAppleRefreshToken` / `insertIdentity` / `createPendingSignIn`) and, in its catch, revokes fire-and-forget only when the grant is not in use; an already-linked Apple ID is never marked at all. Account deletion takes (`DELETE … RETURNING`) and revokes the tokens on link tickets aimed at it, with the same filters.

## Prevention

Any new Apple-token drop point: route it through `revokeUnstoredAppleToken`, never `revokeAppleToken` directly.

## Related Files

- `server/routes/auth-social.ts`, `server/routes/auth.ts`, `server/storage/identities.ts`
