---
title: "A signed receipt is not current — where our own row cannot tell (no row, or a revoked row), ask the store for the status before granting, and pass only the entitled statuses"
track: bug
category: logic-errors
tags: [security, iap, subscription, apple, fail-closed, logging]
module: server
applies_to: ["server/routes/subscription.ts", "server/services/apple-subscription-status.ts", "server/services/receipt-validation.ts", "server/services/store-notifications.ts"]
symptoms: ["A purchase refunded before the app ever sent its receipt grants premium when the old receipt is sent later", "An Apple REFUND notice for an unknown originalTransactionId answers 5xx until Apple stops retrying", "A re-subscription refunded before it was claimed is re-granted from its pre-refund receipt", "A network error reported to Sentry names the request URL and the transaction id in it"]
created: 2026-11-12
severity: medium
---

# A signed receipt is not current: ask the store where our own row cannot tell

Follows `replayed-receipt-must-not-regrant-a-revoked-transaction-2026-10-30.md`, which covers the
case where our row already holds the refund. This file covers the cases where it does not.

## Problem

`applyValidatedReceipt` granted premium from any authentic, unexpired Apple receipt. The only
refund check was `isRevokedForReceipt`, which reads our own `transactions` row. Two refunds never
reach that row in a usable form:

1. **No row yet.** The refund notice names a purchase the server never stored. The webhook answers
   5xx so Apple redelivers; Apple stops after about 6.5 days. Nothing is recorded. A receipt signed
   before the refund has no `revocationDate`, so a later first claim granted premium until the
   receipt's expiry.
2. **A revoked row and an unclaimed re-subscription.** Apple reuses the `originalTransactionId`. The
   row is revoked at t1. The user re-subscribes at t2 and does not send the receipt. The refund at t3
   hits an already-revoked row, and `revokeSubscriptionByTransactionId` keeps
   `LEAST(revokedAt, t3)` = t1. The t2 receipt then passes the date check (t2 > t1).

## Root Cause

A row keyed on `originalTransactionId` holds one status for every period of the subscription. It
can refuse only what a notice wrote into it. A signature proves the receipt is authentic, never
that it is current.

## Solution

- Before `claimTransactionAndUpgrade`, an iOS claim asks Apple (Get All Subscription Statuses) when
  the row is **missing or revoked** (`appleFirstClaimRefusal`). An active or expired row keeps the
  existing path and makes no call.
- **Allow-list the verdict.** Status 5 → `TRANSACTION_REVOKED`. Status 1 (active) or 4 (billing
  grace) → grant. Anything else, a missing status included → `STORE_API_ERROR`. The first version
  refused only on 5, so a listed transaction with no `status` field passed; the library's response
  validator does not check nested items.
- **Fail closed and retryable.** No answer in 10 s (the library's HTTP call has no timeout), an
  API error, or an answer that omits the transaction → `STORE_API_ERROR`. The app keeps the store
  transaction and retries.
- **Report what failed without the id.** The library's `APIException` has an empty message, so the
  report names the HTTP status and Apple's error code (a wrong key is HTTP 401, not an outage).
  node-fetch puts the request URL, which ends in the transaction id, in a network failure's
  message, so any other error is rebuilt with the id replaced before it is logged or reported.
- Google needs none of this: `validateGoogleReceipt` reads the purchase from the Play API on every
  claim.

## Prevention

- When a grant depends on state a webhook delivers, ask what happens if the webhook arrives before
  the row it updates exists, and after the row is already in the target state.
- A check on a third party's status field passes an allow-list of good values. A deny-list of one
  bad value passes every answer the code did not expect.
- A new outbound call turns settings that were only checked for presence into load-bearing ones.
  Say so in `server/CLAUDE.md` and in the PR.
- Before logging a client library's error, check what its message holds. A URL in it carries every
  path parameter.
