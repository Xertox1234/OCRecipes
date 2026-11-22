# Plan: C4 — Apple S2S v2 + Google RTDN refund/revoke webhooks

> **Date:** 2026-05-29
> **Source finding:** C4, 2026-05-29 reliability audit (`todos/2026-05-29-iap-auth-lifecycle-hitl.md`). Human-in-the-loop / never-delegate (IAP).
> **Confirmed decisions:** (1) **Revoke-class only** scope. (2) Authenticate Google push with **`google-auth-library`**.
> **Status:** Planned + decisions confirmed. **Sequencing: implement AFTER PR #270 merges** — depends on its receipt-id keying.

## Context

PR #270 closed the _grant_ side: subscription entitlement is now keyed on the validated receipt's stable id (`transactions.transactionId` = Apple `originalTransactionId` / Google `purchaseToken`, derived server-side). C4 closes the _revoke_ side: when a store issues a refund / revoke / expiry it POSTs a signed notification to a registered URL; with no handler, entitlement never drops — a refunded user keeps premium forever. The payoff of #270: a webhook can find the affected user by the exact same stored key (`getTransaction(stableId) → userId → revoke`). Latent until the first prod refund, but launch-blocking.

## Endpoints

New module `server/routes/store-webhooks.ts`, `export function register(app)`, **registered before the auth-bearing modules** in `server/routes.ts` (stores call them unauthenticated — same ordering as `registerPublicApi`). IP-keyed limiter: `createRateLimiter({ windowMs: 60_000, max: 100, keyByUser: false })` from `server/routes/_rate-limiters.ts`.

- `POST /webhooks/apple/notifications` — App Store Server Notifications V2
- `POST /webhooks/google/rtdn` — Google RTDN (Pub/Sub push)

## Apple flow (`@apple/app-store-server-library` v2)

1. Body: `{ signedPayload: <JWS> }`. The JWS signature **is** the authentication (chains to Apple Root CA).
2. Reuse the existing verifier — expose `verifyAppleNotification(signedPayload)` from `server/services/receipt-validation.ts` (reuses `getAppleVerifier()`): `verifyAndDecodeNotification` → `ResponseBodyV2DecodedPayload`.
3. Dedup on `notificationUUID` (at-least-once delivery).
4. **Revoke** when `notificationType ∈ {REFUND, REVOKE, EXPIRED, GRACE_PERIOD_EXPIRED}`: decode `data.signedTransactionInfo` via `verifyAndDecodeTransaction` → `originalTransactionId` → `revokeSubscriptionByTransactionId`.
5. **Informational** (log, no entitlement change): `DID_CHANGE_RENEWAL_STATUS` (incl. `AUTO_RENEW_DISABLED` — researched footgun: do NOT revoke; sub is active until `expiresDate`), `DID_FAIL_TO_RENEW/GRACE_PERIOD`, `CONSUMPTION_REQUEST`, etc.
6. Return **200** (Apple retries on any non-2xx, 5× over 72h).

## Google flow (RTDN via Pub/Sub push)

1. **Authenticate the push:** verify the OIDC Bearer JWT with `google-auth-library` `OAuth2Client.verifyIdToken({ idToken, audience })` — check `aud` = configured audience and `email` = configured push service account. Reject (401) if invalid/absent.
2. Envelope: `{ message: { data: <base64>, messageId }, subscription }`. Decode `message.data` (base64) → `DeveloperNotification.subscriptionNotification { notificationType, purchaseToken, subscriptionId }`.
3. Dedup on `messageId`.
4. **Revoke** when `notificationType ∈ {SUBSCRIPTION_REVOKED(12), SUBSCRIPTION_EXPIRED(13)}`: **first call `purchases.subscriptionsv2.get(purchaseToken)`** (Google's required pattern — RTDN is a trigger, the API is the truth; reuse `getGoogleAccessToken` + refactor the existing subscriptionsv2 fetch into a shared `fetchGoogleSubscriptionState`), confirm the state is terminated, then `revokeSubscriptionByTransactionId(purchaseToken)`.
5. **Informational:** `SUBSCRIPTION_CANCELED(3)` (active until expiry — do NOT revoke), `ON_HOLD`, `IN_GRACE_PERIOD`, etc.
6. Return **200/204**.

**Caveat — purchaseToken rotation:** Google tokens can rotate on renewal/resubscribe, so the RTDN token may not match the stored one. Handle via the `subscriptionsv2.get` response's `linkedPurchaseToken` chain: if `getTransaction(rtdnToken)` misses, follow `linkedPurchaseToken` to find the stored row. (Apple has no equivalent issue — `originalTransactionId` is stable.)

## Storage

- New `revokeSubscriptionByTransactionId(transactionId): Promise<{ userId } | null>` in `server/storage/users.ts`, atomic in one tx: look up the transaction by `transactionId`; if found, set the user `subscriptionTier = "free"`, `subscriptionExpiresAt = <past/null>`, set the transaction `status = "revoked"`; idempotent (re-revoke is a no-op); return `{ userId }` (caller calls `invalidateTierCache(userId)`) or `null` if not found. Real-DB tests (dual-assertion: revokes the right user; no-op if absent; idempotent).
- New `processed_store_notifications` table (`provider` text, `notificationId` text, unique `(provider, notificationId)`, `createdAt`) for at-least-once dedup + audit. Insert via `onConflictDoNothing()` — empty return = already processed → skip + 200. Hand-written migration (like `migrations/0001_*`) + `shared/schema.ts`.

## Config / deps

- **New dep:** `google-auth-library` (server).
- **New env (optional, add to `server/lib/env.ts`):** `GOOGLE_PUBSUB_AUDIENCE` (push audience), `GOOGLE_PUBSUB_SA_EMAIL` (push service-account email to match the JWT `email` claim). Optionally `STORE_WEBHOOK_VERIFICATION_STUB` for dev/test (mirrors `RECEIPT_VALIDATION_STUB`).
- **Apple:** no new env — the verifier is already configured (`APPLE_*`); the notification URL is registered in App Store Connect, not code.

## Security

- Apple = JWS-cert auth; Google = OIDC-JWT auth. Both endpoints are public but only act on authenticated/valid payloads; reject + 401 otherwise (but still 200 to Apple once _signature-valid_ even if the event is a no-op).
- IP rate-limit; no `requireAuth`; do not leak detail in error bodies.

## Tests (TDD)

- **Storage (real DB):** `revokeSubscriptionByTransactionId` — revokes the right user; no-op when the id is absent; idempotent; cross-user safety.
- **Apple route (mock the verifier + storage, supertest):** signed REFUND → revoke + 200; informational type → no revoke; bad signature → reject; duplicate `notificationUUID` → skip.
- **Google route (mock OIDC verify + Play API + storage):** REVOKED/EXPIRED → confirm-then-revoke + 200; CANCELED(3) → no revoke; bad/absent OIDC → 401; duplicate `messageId` → skip; rotated token → resolved via `linkedPurchaseToken`.

## Testability limit

Cannot be end-to-end verified without deploying + registering the URLs in App Store Connect / Play Console (no prod deployment yet). Handler logic is fully unit/integration-tested with mocked signed payloads; live verification waits for the first deploy.

## Sequencing

Implement on a branch **off the merged #270** (or stacked on `fix/2026-05-29-iap-receipt-binding`) — the webhook lookup-by-stored-key only works once #270's receipt-id keying is in place. Recommend: merge #270 → branch C4 from main.
