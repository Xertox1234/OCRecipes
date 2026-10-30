---
title: "A client receipt is a static snapshot — a refunded/revoked transaction row is re-granted only by a receipt purchased AFTER the revocation"
track: bug
category: logic-errors
tags: [security, database, iap, subscription, idempotency]
module: server
applies_to: ["server/storage/users.ts", "server/routes/subscription.ts", "server/services/receipt-validation.ts", "server/services/store-notifications.ts"]
symptoms: ["A user refunds a subscription, taps Restore, and is premium again", "A transactions row with status revoked flips back to completed on a same-user re-claim", "A DID_RENEW/RTDN renewal re-activates a subscription that was just refunded"]
created: 2026-10-30
severity: high
---

# A client receipt is a static snapshot: a revoked transaction is re-granted only by a later purchase

## Problem

`claimTransactionAndUpgrade` treated a same-user re-claim of an existing `transactionId` as a renewal: it refreshed the row and set tier and expiry. It never looked at the row's `status`. After a refund (the Apple `REFUND`/`REVOKE` notification sets the row to `revoked` and downgrades the user), the user could POST the **pre-refund** signed receipt to `/api/subscription/restore`. The JWS still verifies, since it was signed before the refund and carries no `revocationDate`, and its `expiresDate` may still be in the future. The claim then re-granted premium.

## Symptoms

- A refund followed by a restore leaves the user premium. Store-side the money is back.
- A `transactions` row is `revoked` and its user has `subscriptionTier = premium` with a future expiry.

## Root Cause

Signature verification proves a receipt is authentic. It does not prove the receipt is current. Our DB holds newer facts (the revoke notification) than any client-held snapshot. A row going from `revoked` back to active must be justified by something that happened after the revocation. Apple re-subscriptions reuse the same `originalTransactionId`, so "never reactivate" is too strict.

## Solution

- `isRevokedForReceipt(existing, purchasedAt)` in `server/storage/users.ts` refuses a revoked row unless `purchasedAt > existing.updatedAt` (the revocation write). With no purchase date it **fails closed**.
- `validateAppleReceipt` now returns `purchasedAt` (the JWS `purchaseDate`, which Apple defines as the charge time for a purchase or a renewal). The route passes it to the claim.
- The claim returns `{ status: "revoked" }` with no writes. The route answers 200 `{ success: false, code: ErrorCode.TRANSACTION_REVOKED }`, the same shape as any invalid receipt, so the client leaves the transaction unfinished.
- `extendSubscriptionByTransactionId` (the store-renewal path) applies **the same predicate**. Both paths share `applyRenewalInTx`, the one monotonic `GREATEST(current, incoming)` tier/expiry write. A notification renewal cannot bypass the guard that the receipt path enforces.

## Prevention

- Every write that can move a transaction or entitlement back to active (receipt claim, restore, renewal notification, admin tool) checks the row's current status and requires evidence newer than the revocation. Put the predicate in one shared helper so the paths cannot drift apart.
- Missing dates fail closed: deny the grant, never default to allow. The user can still re-subscribe, which produces a new `purchaseDate`.
- The test covers the replay: revoke the row, re-claim with a receipt whose `purchasedAt` is before `updatedAt`, then assert `revoked`, an unchanged tier, and no row write. Also assert that a later `purchasedAt` re-grants.

## Related Files

- `server/storage/users.ts`: `isRevokedForReceipt`, `applyRenewalInTx`, `claimTransactionAndUpgrade`, `extendSubscriptionByTransactionId`.
- `server/routes/subscription.ts`: the `revoked` decline.
- `server/services/receipt-validation.ts`: `purchasedAt` from the JWS.
- `shared/constants/error-codes.ts`: `TRANSACTION_REVOKED`.
- `server/storage/__tests__/users.test.ts`, `server/routes/__tests__/subscription.test.ts`.

## See Also

- [store-renewal-notifications-must-extend-server-expiry-2026-10-30.md](store-renewal-notifications-must-extend-server-expiry-2026-10-30.md): the renewal path that shares this guard.
- [iap-finish-transaction-only-after-explicit-server-success-2026-10-30.md](iap-finish-transaction-only-after-explicit-server-success-2026-10-30.md): how the client treats the decline.
