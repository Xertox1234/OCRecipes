---
title: A feature-flagged auth gate that reads a JWT claim strands tokens minted before the flip
track: bug
category: logic-errors
module: server
severity: high
tags: [auth, jwt, feature-flag, rollout, requireAuth, lockout]
symptoms: ['After enabling an auth gate (e.g. email-verified) in prod, users who logged in during the gate-OFF window get 403 on every authenticated request until they re-login.', A one-time DB backfill 'grandfathers' existing rows but those users are still locked out.]
applies_to: [server/middleware/auth.ts, server/routes/auth.ts]
created: '2026-06-19'
---

# A feature-flagged auth gate that reads a JWT claim strands tokens minted before the flip

## Problem

A middleware gate that rejects requests on a JWT **claim** (`requireAuth` →
`payload.emailVerified === false`) breaks for every token minted *before* the
gate was switched on. The claim is frozen into the token at issuance; flipping
the flag later cannot rewrite tokens already in the wild.

## Symptoms

- A legacy user (or a new signup) logs in during the deploy→flip OFF window →
  gets a token whose claim reflects the *then-current* DB state (`false`).
- A backfill sets `email_verified = true` in the DB.
- The flag flips ON → that user's still-valid 7-day token carries the stale
  `false` claim → `requireAuth` 403s **every** request until the token expires or
  they happen to re-login.

## Root Cause

`generateToken` baked `emailVerified` into every access token, including
OFF-window ones. The backfill fixes the DB row but cannot touch in-flight tokens.
The runtime claim-check then rejects a user the backfill was supposed to
grandfather. Worse, in steady state the check catches **zero** real threats: when
the gate is ON, the login endpoint already withholds tokens from unverified users
and register issues none — so the only `claim === false` tokens that can exist
are these OFF-window false positives.

## Solution

**Gate at issuance, not at validation.** Keep the real gate on the login
endpoint (refuse to mint a token for an unverified user when the flag is ON) and
**drop the `requireAuth` claim-check** entirely. Grandfather pre-existing and
OFF-window users with the one-time backfill — which the claim-check would
otherwise override.

```ts
// requireAuth: do NOT read payload.emailVerified. The login endpoint is the gate;
// a runtime claim-check strands gate-OFF-window tokens for zero threat-coverage.
```

Keep the claim on the token as inert data if a *future* token path (refresh
tokens, OAuth) that bypasses the login gate might want it — but only add a
runtime reader together with a forced-relogin path (e.g. routing the 403 through
the global session-expiry interceptor) so stranded tokens self-heal instead of
hard-erroring.

## Prevention

When adding a **feature-flagged** auth gate: enforce it where the token is
**minted**, never by reading a claim at validation time — issued tokens outlive
the flag flip. If a claim-check is genuinely needed (a non-login token path), it
must be paired with a client interceptor that forces re-login on the gate's error
code, and the rollout runbook must acknowledge that in-flight tokens aren't
grandfathered by the DB backfill.

## Related Files

- `server/middleware/auth.ts` — `requireAuth` (claim-check intentionally absent), `generateToken`
- `server/routes/auth.ts` — login 403 gate (the real enforcement point)

## See Also

- [anti-enum equalize awaited work before existence check](anti-enum-equalize-awaited-work-before-existence-check-2026-06-19.md) — sibling auth lesson from the same feature
