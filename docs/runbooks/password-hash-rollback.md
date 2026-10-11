# Never roll the server back past the password-policy change

Once the password-policy change (PR 1 of `todos/P2-2026-09-26-password-length-policy.md`) is deployed, **never redeploy an older server build. Fix forward instead.**

## Why

From that deploy on, new and changed passwords are stored as `pv2$` hashes (a SHA-256 pre-hash, then bcrypt), and a successful sign-in quietly upgrades old hashes to `pv2$` too.

An older server doesn't know the `pv2$` prefix. It would compare the typed password against the whole stored string and fail every time. Everyone who signed up, reset their password, or simply signed in after the deploy would be locked out until the newer server came back.

## What to do instead

- A bad deploy that touches anything else: ship a fix on top. The `pv2$` code stays.
- A bug in the password code itself: fix it in `server/lib/password-hash.ts` / `server/lib/password-check.ts` and deploy that. `passwordMatches` must keep verifying both `pv2$` and unprefixed (legacy) hashes.
- If Railway offers "redeploy" on an older deployment, don't take it for any build from before this change.

Design: `docs/superpowers/specs/2026-10-10-password-policy-design.md` §3.
