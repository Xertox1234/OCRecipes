---
title: "Apple receipt JWS signature not verified"
status: done
priority: critical
created: 2026-02-24
updated: 2026-02-24
assignee:
labels: [security, code-review, subscription]
---

# Apple Receipt JWS Signature Not Verified

## Summary

The `decodeAppleJWS` function in `server/services/receipt-validation.ts` (lines 97-119) decodes the JWS payload but does NOT verify the signature against Apple's root certificate chain. An attacker can craft a fake JWS to gain free premium access.

## Background

The code itself acknowledges this in a TODO comment on lines 102-107. Without JWS signature verification, any user can construct a fake receipt and send it to `POST /api/subscription/upgrade` to gain permanent premium access for free. This completely bypasses the subscription/payment system.

## Acceptance Criteria

- [x] JWS x5c certificate chain is verified against Apple's published root certificates
- [x] Invalid/forged receipts are rejected with 403
- [x] Tests cover both valid and forged receipt scenarios
- [x] Stub mode defaults to rejection (not approval) when credentials missing

## Implementation Notes

- Use Apple's App Store Server API v2 for server-side verification
- Or use `app-store-server-library-node` which handles signature verification
- Also fix H-2: Stub mode auto-approves all receipts in non-production (lines 50-61) — default should be rejection

## Dependencies

- Apple Root CA - G3 certificate
- Apple App Store Server credentials properly configured

## Risks

- Revenue loss if exploited before fix
- Breaking change for existing sandbox testing (need explicit stub mode opt-in)

## Updates

### 2026-02-24

- Found during code review by security-sentinel agent
- Also relates to stub mode auto-approval (H-2)

### 2026-02-24 — Resolved

- Replaced `decodeAppleJWS` with `@apple/app-store-server-library` `SignedDataVerifier` (commit 0905ef9)
- Full x5c certificate chain verification against Apple root CAs (G2, G3, Inc)
- Stub mode now requires explicit `RECEIPT_VALIDATION_STUB=true` (three-layer defense)
- 21 receipt validation tests pass including forged receipt rejection
- Documented new patterns in `docs/PATTERNS.md` (commit 9638a33)
