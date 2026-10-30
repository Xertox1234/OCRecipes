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
