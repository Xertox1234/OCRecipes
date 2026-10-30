---
title: "A client receipt is a static snapshot — a refunded/revoked transaction row is re-granted only by a receipt purchased AFTER the revocation"
track: bug
category: logic-errors
tags: [security, database, iap, subscription, idempotency]
module: server
applies_to: ["server/storage/users.ts", "server/routes/subscription.ts", "server/services/receipt-validation.ts", "server/services/store-notifications.ts"]
symptoms: ["A user refunds a subscription, taps Restore, and is premium again", "A transactions row with status revoked flips back to completed on a same-user re-claim", "A DID_RENEW/RTDN renewal re-activates a subscription that was just refunded", "A re-subscriber is refused TRANSACTION_REVOKED after a late EXPIRED notification", "A user whose refund Apple reversed stays locked out"]
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

- **Only refunds block** (owner ruling, PR #1623 review). Only Apple `REFUND`/`REVOKE` and Google `SUBSCRIPTION_REVOKED` (12) mark a row `revoked` (`revokeSubscriptionByTransactionId`). Apple `EXPIRED`/`GRACE_PERIOD_EXPIRED` and Google `SUBSCRIPTION_EXPIRED` (13) go to `expireSubscriptionByTransactionId`: the row becomes `expired` (never overwriting `revoked`) and the user is downgraded the same way, so a re-subscription or a late `DID_RENEW` simply re-activates it. `resolveEffectiveTier` already enforces expiry at read time.
- `isRevokedForReceipt(existing, purchasedAt)` in `server/storage/users.ts` refuses a revoked row unless `purchasedAt > existing.revokedAt`. `transactions.revoked_at` (migration 0032) is the **store's** revocation time: the signed transaction's `revocationDate`, falling back to the notification's `signedDate`, never our processing time (a late-delivered notification must not refuse a purchase made in between). A repeat revoke never moves it later (`LEAST`); every re-activation clears it. Legacy rows without it fall back to `updatedAt`. With no purchase date it **fails closed** (every Google row: Google gives no purchase date).
- **`REFUND_REVERSED`** (Apple) is handled from the verified signed transaction only when `revoked === false`: `reinstateSubscriptionByTransactionId` sets a `revoked` row back to `completed`, clears `revokedAt`, and re-applies premium through `applyRenewalInTx` only while `expiresAt` is in the future (else the row status only). It skips the purchase-date gate: the signed notification authorizes it.
- **Row locks.** Every path that reads the row and then writes entitlement (re-claim branch, extend, revoke, expire, reinstate) takes `.for("update")` on the transactions SELECT. Without it, a renewal that read `completed` before a refund committed overwrote the refund and restored premium (READ COMMITTED re-checks only the UPDATE's WHERE). `server/storage/__tests__/users-subscription.concurrent.test.ts` forces that interleaving on two real connections.
- `validateAppleReceipt` now returns `purchasedAt` (the JWS `purchaseDate`, which Apple defines as the charge time for a purchase or a renewal). The route passes it to the claim.
- The claim returns `{ status: "revoked" }` with no writes. The route answers 200 `{ success: false, code: ErrorCode.TRANSACTION_REVOKED }`, the same shape as any invalid receipt, so the client leaves the transaction unfinished.
- `extendSubscriptionByTransactionId` (the store-renewal path) applies **the same predicate**. Both paths share `applyRenewalInTx`, the one monotonic `GREATEST(current, incoming)` tier/expiry write. A notification renewal cannot bypass the guard that the receipt path enforces.

## Prevention

- Every write that can move a transaction or entitlement back to active (receipt claim, restore, renewal notification, admin tool) checks the row's current status **under a row lock** and requires evidence newer than the revocation. Put the predicate in one shared helper so the paths cannot drift apart.
- Time a revocation by the store's event time, not by when we processed it, and decide deliberately which events block: an expiry is not a refund.
- Missing dates fail closed: deny the grant, never default to allow. The user can still re-subscribe, which produces a new `purchaseDate`.
- The test covers the replay: revoke the row, re-claim with a receipt whose `purchasedAt` is before `revokedAt`, then assert `revoked`, an unchanged tier, and no row write. Also assert that a later `purchasedAt` re-grants, that a late EXPIRED does not block a re-subscription, and that a reversed refund restores the pre-refund receipt.

## Related Files

- `server/storage/users.ts`: `isRevokedForReceipt`, `applyRenewalInTx`, `claimTransactionAndUpgrade`, `extendSubscriptionByTransactionId`, `revokeSubscriptionByTransactionId`, `expireSubscriptionByTransactionId`, `reinstateSubscriptionByTransactionId`.
- `shared/schema.ts` + `migrations/0032_transactions_revoked_at.sql`: `transactions.revoked_at`.
- `server/services/store-notifications.ts`: refund vs expiry routing, `REFUND_REVERSED`.
- `server/routes/subscription.ts`: the `revoked` decline.
- `server/services/receipt-validation.ts`: `purchasedAt` from the JWS.
- `shared/constants/error-codes.ts`: `TRANSACTION_REVOKED`.
- `server/storage/__tests__/users.test.ts`, `server/storage/__tests__/users-subscription.concurrent.test.ts`, `server/routes/__tests__/subscription.test.ts`.

## See Also

- [store-renewal-notifications-must-extend-server-expiry-2026-10-30.md](store-renewal-notifications-must-extend-server-expiry-2026-10-30.md): the renewal path that shares this guard.
- [iap-finish-transaction-only-after-explicit-server-success-2026-10-30.md](iap-finish-transaction-only-after-explicit-server-success-2026-10-30.md): how the client treats the decline.
