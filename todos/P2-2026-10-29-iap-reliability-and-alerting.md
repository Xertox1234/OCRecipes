---
title: "IAP: transient store errors, startup config checks, revoke ordering and alerting"
status: backlog
priority: medium
created: 2026-10-29
updated: 2026-10-29
assignee:
labels: [deferred, iap, security]
github_issue:
human_led: true
blocked_reason: "IAP — human-led with sandbox verification; never autonomously dispatched"
---

# IAP: transient store errors, startup config checks, revoke ordering and alerting

## Summary

A group of in-app-purchase reliability and detection gaps that must be handled by a human with sandbox verification.

## Background

Audit findings (all IAP, surface-only by rule): M-rel-6 — transient Apple OCSP / Google API errors return HTTP 200 success:false INVALID_RECEIPT, indistinguishable from a bad receipt (`server/services/receipt-validation.ts` ~148-157, ~376-401; `server/routes/subscription.ts` ~198-244). M-rel-7 — production IAP/RTDN config is not validated at startup; `APPLE_ENVIRONMENT` silently defaults to SANDBOX (`server/lib/env.ts` ~165-215). M-obs-2 — a bare `catch {}` around `getGoogleAccessToken()` makes every Android purchase fail with no log (`receipt-validation.ts` ~361-363). M-obs-3 — receipt verification and Pub/Sub OIDC failures log but never alert (`receipt-validation.ts` ~169-179, ~373-388; `store-notifications.ts` ~97, ~112). M-obs-4 — the client's charged-but-unclaimed purchase warning is a no-op in production builds (`client/lib/iap/expo-iap-adapter.ts` ~116-119, `client/lib/logger.ts` ~23-28). L-rel-8 — a revoke notification arriving before the local transaction row is dropped with 200. L-rel-9 — the Google OAuth token fetch is not single-flight. L-cq-1 — the Google Pub/Sub payload is JSON.parsed without Zod (`store-notifications.ts` ~132-146). L-data-8 — account deletion cascades the transactions ledger, so one store transaction can be re-claimed by a new account.

Found by the 2026-10-29 pre-launch audit (manifest `docs/audits/2026-10-29-pre-launch.md`, local-only); deferred from the unattended overnight run because it needs a decision or verification that run could not make.

## Acceptance Criteria

- [ ] Each item above is fixed or explicitly accepted by the owner, one PR per cluster
- [ ] Transient store failures return a distinct retryable code; the client keeps the receipt for retry
- [ ] validateEnv warns/fails on half-configured IAP in production
- [ ] Verification and RTDN failures reach Sentry (rate-limited)
- [ ] Sandbox purchase + restore + refund checks pass (launch-prep checklist)

## Implementation Notes

Never delegate (CLAUDE.md: IAP receipt validation is excluded from cheap workers and autonomous fixes). Paid Apps agreement waits for launch (owner ruling 2026-10-28) — sandbox checks follow that.

## Scope Contract

- **Files in scope:** `server/services/receipt-validation.ts`, `server/services/store-notifications.ts`, `server/routes/subscription.ts`, `server/lib/env.ts`, `server/storage/users.ts` (transactions), `client/lib/iap/expo-iap-adapter.ts`, `client/lib/logger.ts` and tests
- No new mechanisms, files, or abstractions beyond those listed.

## Updates

### 2026-10-29

- Initial creation (pre-launch audit, overnight run)

### 2026-11-06: code fixes (owner unlocked this human-led todo for the code part, interactive /goal session)

Each item checked against the code first:

- **M-obs-2 — already fixed** before this run: the Google token fetch logs, reports to Sentry and returns `STORE_API_ERROR`.
- **M-rel-7 — already fixed**: `iapConfigWarnings` in `server/lib/env.ts` warns on half-configured Apple/Google IAP, a missing bundle id, `APPLE_ENVIRONMENT` not "production" in production, and missing Pub/Sub audience/email.
- **M-rel-6 — fixed (Apple half).** Google outages already answered `STORE_API_ERROR`. Apple `RETRYABLE_VERIFICATION_FAILURE` and unexpected errors now do too (were `INVALID_RECEIPT`). The client already keeps every non-success transaction unfinished (`entitlementError` in `client/lib/iap/purchase-utils.ts`), and shows "store unavailable" for this code.
- **L-rel-9 — fixed**: the Google OAuth token exchange is single-flight; a failed exchange is not cached.
- **M-obs-3 — fixed**: a failed Pub/Sub OIDC check is reported to Sentry, at most once an hour. Apple verification failures were already `log.error` (Sentry).
- **L-cq-1 — fixed**: Zod on the decoded RTDN payload.
- **L-rel-8 — fixed (Apple)**: a REFUND/REVOKE with no local row throws so Apple redelivers. Google needs nothing: a later claim re-reads Play's live state, which is already revoked.
- **M-obs-4 — NOT changed, owner decision.** The "store delivered a purchase with none pending" path also catches unsolicited deliveries such as iOS renewal transactions at launch, so making it `logger.error` could page Sentry on every renewal. Options: leave it, or report it once per session.
- **L-data-8 — NOT changed, owner decision.** Account deletion cascades the `transactions` ledger, so a store transaction can be re-claimed by a new account. Fixing it needs a migration (keep or anonymise ledger rows on delete) and a data-retention ruling for the right-to-erasure path.
- **Still open**: the sandbox purchase/restore/refund checks (launch-gated), M-obs-4, L-data-8.
