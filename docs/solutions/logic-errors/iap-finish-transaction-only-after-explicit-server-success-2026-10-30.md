---
title: "An IAP transaction is finished only after the server body says success: true — a declined receipt is HTTP 200, so apiRequest resolving proves nothing"
track: bug
category: logic-errors
tags: [client-state, security, iap, subscription, react-native]
module: client
applies_to: ["client/lib/iap/usePurchase.ts", "client/lib/iap/purchase-utils.ts", "client/components/upgrade-modal-utils.ts", "server/routes/subscription.ts"]
symptoms: ["A purchase during a Play/App Store API outage charges the user, shows no Premium, and Restore finds nothing to claim", "Android purchase auto-refunded or iOS transaction gone from the queue after the server answered {success:false}", "A refunded/expired receipt replayed on restore shows retryable 'Please try again' copy forever"]
created: 2026-10-30
severity: high
---

# An IAP transaction is finished only after the server body says success: true

## Problem

`usePurchase` called `iap.finishTransaction(result)` as soon as `await apiRequest("POST", "/api/subscription/upgrade" | "/restore", ...)` resolved. The subscription routes decline a receipt with **HTTP 200** and `{ success: false, code }` (e.g. `STORE_API_ERROR` on a store outage, `TRANSACTION_REVOKED`, `PRODUCT_MISMATCH`). `apiRequest` throws only on a non-2xx status, so a decline looked like success: the client consumed/acknowledged the store transaction although the server granted nothing. The store never redelivers a finished transaction, so the user paid and has no entitlement and nothing to restore.

## Symptoms

- A purchase made while the Play Developer API is down charges the user but Premium never appears. A later Restore finds no unclaimed purchase.
- Nothing is logged on the client. The server logged a correct decline.

## Root Cause

The client treated transport success as business success. The `apiRequest` contract (`docs/rules/client-state.md`) covers status codes only. Any route that reports a business decline in a 200 body needs the caller to read the body, and `finishTransaction` cannot be undone.

## Solution

- `entitlementError(body)` in `client/lib/iap/purchase-utils.ts` returns `null` only for an explicit `success === true`. Anything else, including a non-JSON body (`res.json().catch(() => null)`), fails closed with a `PurchaseError`. The hook sets an error state and **returns before `finishTransaction`**, so the store redelivers the transaction.
- Codes are mapped by whether a retry can help:
  - `STORE_API_ERROR` maps to `STORE_UNAVAILABLE`, which is retryable.
  - Permanent declines (`ErrorCode.TRANSACTION_REVOKED`, `SUBSCRIPTION_EXPIRED`, `PRODUCT_MISMATCH`) map to `PURCHASE_DECLINED`. `getUpgradeErrorMessage` gives it non-retry copy, so a replayed dead receipt does not keep the user on "try again".
  - Anything else maps to `UNKNOWN`.
- Even a permanent decline is left unfinished. Google Play auto-refunds an unacknowledged purchase, and a replay only surfaces through the adapter's `unclaimed` set on a user-initiated restore. It does not loop automatically.

## Prevention

- Before any irreversible client step (`finishTransaction`, consuming a token, deleting a local draft), find the server's decline shape. If it can be a 2xx, gate on the body field, never on `apiRequest` resolving.
- Every decline code the server can emit must map to copy that matches whether a retry can succeed. A new server decline code also gets added to `PERMANENT_DECLINE_CODES` when no retry can fix it.
- The test sets up a resolved 200 `{ success: false }` and asserts `finishTransaction` was **not** called. A happy-path-only test cannot catch this.

## Related Files

- `client/lib/iap/usePurchase.ts`: purchase and restore flows.
- `client/lib/iap/purchase-utils.ts`: `entitlementError`, `PERMANENT_DECLINE_CODES`.
- `client/components/upgrade-modal-utils.ts`: `PURCHASE_DECLINED` copy.
- `client/lib/iap/__tests__/usePurchase.hook.test.ts`, `client/lib/iap/__tests__/purchase-utils.test.ts`.
- `server/routes/subscription.ts`: 200 + `success:false` decline shape.

## See Also

- [replayed-receipt-must-not-regrant-a-revoked-transaction-2026-10-30.md](replayed-receipt-must-not-regrant-a-revoked-transaction-2026-10-30.md): the server-side decline that produces `TRANSACTION_REVOKED`.
- [dead-apirequest-guard-hides-broken-error-branch-2026-05-31.md](dead-apirequest-guard-hides-broken-error-branch-2026-05-31.md): the status-only `apiRequest` contract.
