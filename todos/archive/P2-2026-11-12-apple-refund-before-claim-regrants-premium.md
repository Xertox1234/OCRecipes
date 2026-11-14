---
title: "Apple refund that arrives before the receipt is claimed is lost — check Apple's current status at first claim"
status: done
priority: medium
created: 2026-11-12
updated: 2026-11-12
assignee:
labels: [deferred, security]
github_issue:
human_led: true
---

# Apple refund that arrives before the receipt is claimed is lost

## Summary

When Apple sends a refund notice for a purchase the server has never stored, the notice is not
recorded. Once Apple stops retrying, a receipt signed before the refund still grants premium until
its expiry date. Check the purchase's current status with Apple when a receipt is first claimed.

## Background

Found by the security audit of 2026-11-12 (finding M2, Medium). The owner ruled the same day: fix
it in its own PR, not in the audit PR. It is in-app purchase code, so it is `human_led` — never
dispatched by `/todo` on its own.

What the code does today:

- `server/services/store-notifications.ts:207-218` — a refund for an unknown transaction id only
  throws, so the webhook answers 5xx and Apple redelivers. Nothing is stored. The comment there
  says an unclaimed purchase "exhausts Apple's retries harmlessly"; that is wrong.
- Apple retries a failed V2 notice five times (1, 12, 24, 48 and 72 hours after the previous
  attempt, about 6.5 days in all) and then stops. The sandbox sends once. Source: Apple,
  "Responding to App Store Server Notifications".
- `server/services/receipt-validation.ts:187, 212-229` — a receipt is refused only for a
  `revocationDate` or a past `expiresDate` inside the signed payload. A receipt signed before the
  refund has neither.
- `server/storage/subscriptions.ts:119-135` — the first-insert branch of
  `claimTransactionAndUpgrade` grants premium. `isRevokedForReceipt` (50-57) only looks at rows
  that already exist.
- No non-test code in `server/` calls the App Store Server API (`AppStoreServerAPIClient`,
  `getAllSubscriptionStatuses`, `getRefundHistory`, `getNotificationHistory`: 0 hits).

So a refund that lands before the first claim leaves no trace, and the old receipt is accepted
later. This is the same replay class as
`docs/solutions/logic-errors/replayed-receipt-must-not-regrant-a-revoked-transaction-2026-10-30.md`,
one step earlier: that fix needs a stored row, and here there is none.

## Acceptance Criteria

- [x] A failing test first: a refund notice for an unknown transaction, then a claim with the
      pre-refund receipt, must not grant premium.
- [x] At first claim of an Apple transaction, the server asks Apple for the current status and
      refuses a refunded or revoked purchase (status 5).
- [x] When Apple's API cannot be reached at claim time, the claim is refused with a retryable
      error and nothing is granted. (Recommended in the audit; the owner accepted the audit's
      suggestions on 2026-11-12 without a separate word on this point — confirm before building.)
- [x] The wrong "harmlessly" comment in `store-notifications.ts` is corrected.
- [x] The Google half (`handleGoogleNotification`, Google receipt validation) is read for the same
      gap; the audit did not assess it. Record the result, fix or file.
- [x] PR carries the `security` label and is not auto-merged.

## Implementation Notes

- `@apple/app-store-server-library` 2.0.0 is already installed and has what is needed:
  `getAllSubscriptionStatuses(transactionId, status?)`, `getRefundHistory(transactionId, revision)`,
  `getNotificationHistory(...)`, `getTransactionInfo(transactionId)`
  (`node_modules/@apple/app-store-server-library/dist/index.d.ts:157, 167, 196, 216`).
- The client constructor takes the signing key, key id, issuer id, bundle id and environment. The
  server already requires `APPLE_ISSUER_ID`, `APPLE_KEY_ID` and `APPLE_PRIVATE_KEY`
  (`server/lib/env.ts:93-95`), so no new secret is needed.
- Two shapes were considered: (a) ask Apple at first claim — closes the gap at the point of grant;
  (b) store a revoked ownerless row when a refund names an unknown transaction — `transactions.userId`
  has been nullable since migration 0038 and the ownerless branch already refuses a pre-refund
  receipt against a revoked ownerless row. (b) needs no network call but only works while the
  notice is delivered at all. (a) is the recommended fix; (b) may be added on top.
- Apple's docs do not say in so many words that a server should check status when validating a
  device-supplied transaction. They do say Get All Subscription Statuses gives "up-to-date
  subscription status". Whether Get Transaction Info reflects a refund is not documented.
- Not exercised against Apple in the audit. The sandbox sends a notice only once, so a sandbox
  test of the retry window is not possible.

## Scope Contract

- **Mechanisms to use:** the installed `@apple/app-store-server-library` API client; the existing
  claim path. No new dependency, no new env variable.
- **Files in scope:** `server/services/receipt-validation.ts`, `server/services/store-notifications.ts`,
  `server/storage/subscriptions.ts`, `server/routes/subscription.ts`, their `__tests__/` files.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- Apple App Store Server API reachable from the server (production and sandbox environments).

## Risks

- A network call on the purchase path: an Apple outage would block new upgrades while it lasts.
- Route tests mock much of this path; the test must exercise the real claim logic.

## Updates

### 2026-11-12

- Initial creation (security audit 2026-11-12, finding M2; owner: fix in its own PR)

### 2026-11-12 — built

- Shape (a) built: `appleFirstClaimRefusal` asks Apple (Get All Subscription Statuses) when an iOS
  receipt names a transaction with no stored row, before `claimTransactionAndUpgrade`. Status 5
  → `TRANSACTION_REVOKED`. No answer in 10 s, an API error, or an answer that does not list the
  transaction → `STORE_API_ERROR` (retryable), nothing granted. Shape (b) was not built.
- Outside the scope contract: the check lives in a new file,
  `server/services/apple-subscription-status.ts`, because adding it to `receipt-validation.ts` took
  that file to 611 lines (the bar is 600).
- Fail-closed on an unreachable Apple API was built as recommended and put to the owner with the
  merge question, not before building.
- `APPLE_ISSUER_ID`, `APPLE_KEY_ID` and `APPLE_PRIVATE_KEY` are used for a real call for the first
  time. Until now only their presence was checked. A wrong key makes every first Apple claim fail
  with `STORE_API_ERROR` and a Sentry report naming HTTP 401.
- Google half, read: `validateGoogleReceipt` reads the purchase from the Play API on every claim,
  so a refunded or revoked purchase is refused at claim whether or not a row exists. A Play
  revoke notice for an unknown token only logs. No gap found at claim; nothing filed.
- Not exercised against Apple: tests mock the library's API client.

### 2026-11-12 — review fixes

- The check also runs when the stored row is `revoked`: a re-subscription reuses the
  `originalTransactionId`, and its refund, if it was never claimed, left `revokedAt` at the
  earlier refund, so its pre-refund receipt passed the date check (security-auditor finding;
  already on `main` before this PR).
- Only status 1 (active) and 4 (billing grace) pass. Any other status, or none, is
  `STORE_API_ERROR`.
- A network failure's reported message no longer holds the transaction id.
