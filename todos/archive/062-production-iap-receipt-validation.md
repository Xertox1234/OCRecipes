---
title: "Production IAP: real receipt validation and expo-iap integration"
status: backlog
priority: high
created: 2026-02-09
updated: 2026-02-09
assignee:
labels: [payments, security, production, subscription]
---

# Production IAP: Real Receipt Validation & expo-iap Integration

## Summary

The IAP purchase flow is implemented but stubbed for development. Real Apple/Google receipt validation and verified expo-iap runtime integration are required before the app can accept real payments.

## Background

Commit 62d05ae added the client-side purchase flow (usePurchase hook, UpgradeModal, mock-iap, server endpoints). In dev mode, `mock-iap.ts` auto-approves all purchases and `receipt-validation.ts` stubs validation. Three things remain before this is production-ready:

1. **Receipt validation** — Apple App Store Server API and Google Play Developer API integrations are TODO stubs
2. **expo-iap runtime** — The production branch of `client/lib/iap/index.ts` does `require("expo-iap").useIAP` which may not match expo-iap's actual export API; needs verification on a real native build
3. **App Store/Play Store configuration** — Product IDs, shared secrets, and service accounts need to be set up

## Acceptance Criteria

- [ ] `validateAppleReceipt()` in `server/services/receipt-validation.ts` calls Apple App Store Server API v2 with `APPLE_SHARED_SECRET`
- [ ] `validateGoogleReceipt()` in `server/services/receipt-validation.ts` calls Google Play Developer API with service account credentials
- [ ] Both validators verify: bundle/package ID, product ID, transaction expiration, and purchase state
- [ ] Stub mode is confirmed to reject in production (`NODE_ENV === "production"` guard works)
- [ ] `client/lib/iap/index.ts` production branch works with real expo-iap on a native build (iOS simulator or device)
- [ ] Product ID `com.nutriscan.premium.annual` is created in App Store Connect and Google Play Console
- [ ] Environment variables added: `APPLE_SHARED_SECRET`, Google Play service account credentials
- [ ] End-to-end test: purchase flow works on iOS simulator with sandbox App Store account
- [ ] Duplicate transaction detection works with real transaction IDs

## Implementation Notes

### Files to modify

| File                                    | Change                                                           |
| --------------------------------------- | ---------------------------------------------------------------- |
| `server/services/receipt-validation.ts` | Replace TODO stubs with real Apple/Google API calls              |
| `client/lib/iap/index.ts`               | Verify and fix expo-iap production import (test on native build) |
| `.env.example`                          | Add `APPLE_SHARED_SECRET`, Google Play credentials               |

### Receipt validation stubs (current state)

```typescript
// server/services/receipt-validation.ts — lines to replace
async function validateAppleReceipt(_receipt: string) {
  return { valid: false, errorCode: "NOT_IMPLEMENTED" };
}

async function validateGoogleReceipt(_receipt: string) {
  return { valid: false, errorCode: "NOT_IMPLEMENTED" };
}
```

### expo-iap production import (verify)

```typescript
// client/lib/iap/index.ts — production branch
const expoIap = require("expo-iap");
_useIAP = expoIap.useIAP; // ← verify this matches expo-iap's actual exports
```

Check expo-iap docs for the correct hook import pattern. May need `useIAP({ skus: [...] })` initialization or an `IAPProvider` wrapper.

### App Store Connect setup needed

- Create annual subscription product with ID `com.nutriscan.premium.annual`
- Set up 3-day free trial offer
- Generate shared secret for server-side validation
- Create sandbox tester account for testing

### Google Play Console setup needed

- Create subscription product with same ID
- Set up service account with Play Developer API access
- Export service account JSON credentials

## Dependencies

- Apple Developer account with App Store Connect access
- Google Play Developer account with API access
- Native build environment (Xcode, iOS simulator) for testing

## Risks

- **Security critical**: Without real receipt validation, anyone can claim premium with a fake receipt
- **expo-iap API surface**: Hook API may differ from what we've assumed; needs runtime testing
- **App Store review**: Apple may reject if receipt validation isn't working correctly
- **Sandbox testing**: Apple sandbox environment can be unreliable

## Updates

### 2026-02-09

- Created from IAP implementation review
- Client flow and server endpoints are complete but stubbed
- See `docs/LEARNINGS.md` > "Subscription & Payment Learnings" for stub safety patterns
