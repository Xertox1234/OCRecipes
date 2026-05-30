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

This supersedes/overlaps the pre-existing `todos/2026-05-29-critical-reliability-findings.md` (on branch `chore/2026-05-29-reliability-findings`) for C1/C4 — reconcile the two.

## Acceptance Criteria

- [x] **C1 (DONE — both `/restore` AND `/upgrade`):** entitlement is keyed on the validated receipt's `originalTransactionId` (Apple) / `purchaseToken` (Google), derived server-side (never client/random); the global `transactionId` unique constraint makes a second account's claim collide → 409 reject. Branch `fix/2026-05-29-iap-receipt-binding`. (Scope expanded to `/upgrade` because it had the same client-`transactionId`-replay hole.)
- [ ] **C4:** consume Apple S2S v2 + Google RTDN (refund/cancel/revoke/expire) so entitlement cannot drift.
- [ ] **H3:** a 401 triggers a clear logout/"session expired" path; auth re-checked on `AppState` foreground; corrupt persisted auth handled without a silent logout.
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
