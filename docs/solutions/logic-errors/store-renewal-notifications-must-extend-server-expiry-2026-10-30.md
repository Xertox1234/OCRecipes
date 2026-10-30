---
title: "Store renewal notifications must extend the server's expiry — and a Google CANCELED subscription stays entitled until its expiryTime"
track: bug
category: logic-errors
tags: [architecture, database, security, iap, subscription, webhooks]
module: server
applies_to: ["server/services/store-notifications.ts", "server/services/receipt-validation.ts", "server/storage/users.ts"]
symptoms: ["An auto-renewing subscriber drops to free at the end of the first billing period and only gets premium back after tapping Restore", "users.subscriptionExpiresAt never moves past the first period end despite DID_RENEW / SUBSCRIPTION_RENEWED webhooks arriving", "A Google user who turned off auto-renew is told PURCHASE_NOT_ACTIVE on restore while still inside the paid period"]
created: 2026-10-30
severity: high
---

# Store renewal notifications must extend the server's expiry

## Problem

Two related gaps in how the server modelled the subscription lifecycle:

1. **Renewals were informational.** `handleAppleNotification`/`handleGoogleNotification` acted only on revoke-class events. Every other type was only logged. The server expiry was set once by the client receipt claim. Apple's `expiresDate` is fixed per transaction (each renewal is a new transaction), and Google's RTDN carries no expiry. So the expiry stopped at the end of the first period, and `getEffectiveTierForUser` downgraded a paying subscriber until they tapped Restore.
2. **Google `SUBSCRIPTION_STATE_CANCELED` was treated as inactive.** CANCELED means auto-renew is off. Play Billing keeps access until `lineItems[0].expiryTime`. Rejecting it with `PURCHASE_NOT_ACTIVE` denied a restore to a user who was still paid up.

## Symptoms

- Premium disappears at period end for auto-renewing users. Restore brings it back.
- Webhook logs show `DID_RENEW` / RTDN type 2 arriving with "informational" and no write.

## Root Cause

The notification handler covered only the money-out events (refund, revoke, expire). A subscription's entitlement window is driven by the store over its whole life. It is not fixed at first purchase. Any state the server caches (expiry) needs a writer for each store event that moves it.

## Solution

- **Apple `DID_RENEW`** (including subtype `BILLING_RECOVERY`): `verifyAppleNotification` now also returns the signed transaction's `expiresAt`, `purchasedAt` and `revoked`. The handler extends from those **store-signed** values. It skips when there is no `originalTransactionId` or `expiresAt`, or when `revoked` is set.
- **Google `SUBSCRIPTION_RENEWED` (2) / `SUBSCRIPTION_RECOVERED` (1)**: the RTDN has no expiry, so re-read live state through `validateReceipt(purchaseToken, "android")` (the Play API path the receipt flow already uses) and extend from `live.expiresAt`. A transient `STORE_API_ERROR` (Play 5xx/429/401/403, network, timeout, token fetch) **throws**, so the route answers 5xx and Pub/Sub redelivers; so do `PLATFORM_NOT_CONFIGURED` and `NOT_IMPLEMENTED` (the production stub), since a fixed config makes the retry succeed. A permanent answer logs and returns 2xx: Play 400/404/410 map to `PURCHASE_TOKEN_INVALID` (unknown or foreign token), never to `STORE_API_ERROR`, so a dead token cannot loop Pub/Sub for its whole retention window.
- `storage.extendSubscriptionByTransactionId` is not user-scoped (`// idor-safe`): the store is the caller, and the route has already verified the JWS/OIDC signature. It returns `null` for an unknown id (the receipt flow has not stored it yet), returns `revoked` under the shared refund-replay guard, and otherwise performs a monotonic `GREATEST` extend. The tier cache is invalidated after commit.
- `SUBSCRIBED` and `DID_CHANGE_RENEWAL_*` stay informational. Auto-renew off is not a revoke, and the first grant stays on the client receipt flow.
- `REFUND_REVERSED` reinstates a refunded row (see the revoked-transaction doc); `EXPIRED`/`GRACE_PERIOD_EXPIRED` are a plain expiry, not a revoke.
- **Google CANCELED** is valid while `expiryTime` is in the future. A past expiry gives `SUBSCRIPTION_EXPIRED`. A missing or unparseable expiry fails closed with `PURCHASE_NOT_ACTIVE`. `ON_HOLD`/`PAUSED` are still rejected.

## Prevention

- When adding or reviewing a store webhook handler, list every lifecycle event against every server-cached field (tier, expiry, status). Each pair needs a writer, or a written-down reason why that event does not move that field.
- Extension values come only from store-verified data (signed payload or live API read), never from the client or the notification envelope.
- Separate transient from permanent in webhook handlers: throw on transient (the store retries), and return 2xx with a log on permanent (a retry storm cannot fix it).

## Related Files

- `server/services/store-notifications.ts`: `APPLE_RENEW_TYPES`, `GOOGLE_RENEW_TYPES`, `applyRenewal`.
- `server/services/receipt-validation.ts`: `verifyAppleNotification` fields, Google CANCELED branch.
- `server/storage/users.ts`: `extendSubscriptionByTransactionId`, `applyRenewalInTx`.
- `server/services/__tests__/store-notifications.test.ts`, `server/services/__tests__/receipt-validation.test.ts`.

## See Also

- [replayed-receipt-must-not-regrant-a-revoked-transaction-2026-10-30.md](replayed-receipt-must-not-regrant-a-revoked-transaction-2026-10-30.md): the revoked guard this path shares.
