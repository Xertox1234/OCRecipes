---
title: "HUMAN-IN-THE-LOOP: IAP restore idempotency, store webhooks, auth lifecycle (never-delegate)"
status: backlog
priority: high
created: 2026-05-29
updated: 2026-05-29
assignee:
labels: [reliability, security, iap, auth, never-delegate, deferred]
github_issue:
---

# IAP + auth lifecycle (human-in-the-loop)

## Summary

Money- and auth-correctness findings from the 2026-05-29 reliability audit. These touch IAP receipt validation and JWT auth — **never auto-fix / never-delegate per project rules**. They require manual, fully-verified handling.

## Background

Reliability audit Classes 3 (idempotency/money) and 6 (auth lifecycle):

- **C1 (Critical, live exploit):** `/api/subscription/restore` mints `restore-${randomUUID()}` as `transactionId` and discards the receipt's `originalTransactionId` → one Apple subscription claimable by N accounts (`server/routes/subscription.ts:202-215`).
- **C4 (Critical, latent):** no Apple App Store Server Notifications V2 / Google RTDN handlers → refunds/cancellations never revoke entitlement (`server/routes/`). Doc-confirmed these are the current mechanisms (Apple: REFUND/DID_CHANGE_RENEWAL_STATUS/EXPIRED; Google RTDN: CANCELED/REVOKED/EXPIRED).
- **L1 (Low, mitigated):** duplicate-transaction check is non-atomic TOCTOU (`subscription.ts:117-126`), backstopped by the `transactionId` unique constraint (`shared/schema.ts:1329`).
- **H3 (High):** no global 401→logout interceptor + no `AppState` foreground auth re-check; corrupt auth-blob `JSON.parse` silently logs out (`client/lib/query-client.ts`, `client/hooks/useAuth.ts:55-73`).

## Acceptance Criteria

- [x] **C1 (DONE — both `/restore` AND `/upgrade`):** entitlement is keyed on the validated receipt's `originalTransactionId` (Apple) / `purchaseToken` (Google), derived server-side (never client/random); the global `transactionId` unique constraint makes a second account's claim collide → 409 reject. Branch `fix/2026-05-29-iap-receipt-binding`. (Scope expanded to `/upgrade` because it had the same client-`transactionId`-replay hole.)
- [x] **C4 (DONE):** Apple App Store Server Notifications V2 (`/webhooks/apple/notifications`) + Google Play RTDN (`/webhooks/google/rtdn`) revoke-class events (refund/revoke/expire) drop entitlement via `revokeSubscriptionByTransactionId`, keyed on the same stable id #270 stores. Apple = JWS-sig auth; Google = Pub/Sub OIDC auth (`google-auth-library`). Branch `feat/2026-05-29-iap-store-webhooks`. Revoke-class only (informational events make no change); the revoke payer-guard prevents downgrading a re-subscribed customer.
- [x] **H3 (DONE):** centralized 401 interceptor — `query-client.ts` fires a module-level `subscribeToSessionExpiry` emitter on a token-bearing 401 (from both `apiRequest` and `getQueryFn`, before the `returnNull` short-circuit; a 401 with NO token attached, e.g. wrong-password login, does not fire). A new `SessionExpiryBridge` (sibling of `QueryErrorToastBridge`) subscribes and runs `expireSession()` — a local-only teardown (token + AsyncStorage + `queryClient.clear()`, NO server `/logout` call, which would 401-loop) + a "session expired" toast gated on being authenticated this session. Foreground re-check via `AppState` (option a, not focusManager — minimal change to high-risk auth) with a `hasBeenBackgrounded` latch (correct across iOS `background→inactive→active`, ignores spurious mount `active` + control-center churn) + in-flight guard. Corrupt persisted-auth blob: `JSON.parse` wrapped — drops the poison key and preserves the token (no silent logout; self-heals on next re-check). Branch `worktree-h3-auth-lifecycle`. Real-module TDD: `useAuth.test.ts`, `session-expiry.test.ts` (real `query-client`), `SessionExpiryBridge.test.tsx`.
- [x] **L1 (DONE):** the non-atomic read-then-write dedup is removed; `claimTransactionAndUpgrade` does insert-`onConflictDoNothing` + ownership re-check + upgrade atomically in one tx (the unique constraint is the concurrent-race backstop). Renewal expiry is monotonic (`GREATEST`, so a stale/out-of-order receipt can't shorten premium).

## Implementation Notes

- **NEVER DELEGATE** (CLAUDE.md): JWT auth, IAP receipt validation, user health data. Manual handling with full verification only.
- H3 better-fix (docs): RN `AppState.addEventListener('change')` for foreground re-check, OR lift the auth check into a TanStack query so `focusManager` refetches it for free.

## Dependencies

- Auth has a documented history of repeated breakage (memory `project_auth_recurring_breakage`) — treat as high-risk; prioritize real-module tests.

## Risks

- C1 is a live revenue exploit; C4 latent until first refund. Auth changes are high-risk by project history.

## Updates

### 2026-05-29

- Created from the reliability audit. Human-in-the-loop: surfaced for manual handling, not fixed in the audit loop.

### 2026-05-30

- H3 implemented manually (never-delegate auth) with real-module TDD; all four acceptance points (C1/C4/L1/H3) now done. Foreground re-check decision: AppState (option a) over focusManager, pressure-tested with kimi-challenge + advisor. Opened a PR for human review (HITL) — not merged directly.
