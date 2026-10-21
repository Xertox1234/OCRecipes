---
title: "A lasting write made before a check that can still refuse survives the refusal — put the check inside the write's own transaction, or act only on what the guarded write returned"
track: bug
category: logic-errors
tags: [security, database, api]
module: server
applies_to: ["server/storage/identities.ts", "server/routes/auth-mfa.ts", "server/routes/auth-social.ts", "server/storage/push-tokens.ts"]
symptoms: ["A request answers 401 or 409 but its side effect is still in the database", "A Google/Apple link survives the password reset that should have stopped it", "Disconnecting Apple fails with 409 and the kept Apple sign-in's grant is dead"]
created: 2026-10-20
severity: medium
---

# A lasting write made before a check that can still refuse survives the refusal

## Problem

The ultrareview of PR #1371 (2026-10-20) found two routes with the same shape. Each made a lasting change, then reached a later step that could still refuse. The refusal stopped the request but not the change:

- **Link after a 2FA code or password proof** (`/api/auth/mfa/verify`, `/api/auth/social/link`): the route checked `tokenVersion` once, then `completeLinkByTicketHash` inserted the identity in its own transaction, then `issueSession` re-checked the version and refused. A reset committing between the first check and the insert left the attacker's identity linked. The client saw a 401.
- **Apple disconnect** (`DELETE /api/auth/identities/apple`): the route revoked the Apple token at Apple, then called `deleteIdentity`. That delete re-checks "not the last sign-in method" under a row lock (audit L16) and can refuse. The 409 kept the Apple identity with a revoked grant.

Audit L12 had already fixed the session half of the first case. That fix guarded the step that could be retried (the session) and left the lasting one (the link) outside the guard.

## Root Cause

A refusal can only undo what it shares a transaction with. A check at step 1 plus a re-check at step 3 does not protect a write at step 2 that committed on its own. An outward call such as Apple's revoke can never be rolled back at all.

## Solution

- **Move the check into the write's transaction.** `completeLinkByTicketHash` now takes the token version as a **required** option, locks the `users` row with `FOR UPDATE`, and throws `TokenVersionChangedError` when the version moved. The throw rolls back the ticket delete, the identity insert and the email-verified mark together. Both routes map the error to the same `401 MFA_CHALLENGE_EXPIRED` that `issueSession` gives for this race.
- **Order an irreversible outward call after the guarded write, and feed it the write's result.** The disconnect route now calls `deleteIdentity` first and revokes only the row it returned. The row still carries `appleRefreshTokenEnc`, so revoking second loses nothing.

## Prevention

When a route has a refusable step (a lock re-check, a version re-check, a compare-and-swap), list every lasting effect before it: inserts, deletes, emails, provider calls. Each one either moves inside that step's transaction or moves after it and uses what it returned. A re-check after the effect only decides the answer the client gets.

Related: [optional guard argument](optional-guard-argument-skipped-at-new-call-sites-session-mint-version-2026-10-11.md), [request dispatched in one session lands in the next](request-dispatched-in-one-session-lands-in-the-next-2026-10-11.md).
