---
title: Stub service with production safety gate (three-layer defense)
track: knowledge
category: design-patterns
module: server
tags: [api, stub, production, env, security]
applies_to: [server/services/**/*.ts]
created: '2026-05-13'
---

# Stub service with production safety gate (three-layer defense)

## When this applies

When integrating third-party services that require credentials not available in development (App Store / Google Play APIs, payment processors, push notification services), you need a stub that auto-approves in dev but refuses to silently auto-approve in production.

## Why

A naive "auto-stub if credentials missing" leaks into production the day someone deploys without the credentials configured. The three-layer defense — explicit opt-in env var + credential absence + NODE_ENV check — makes it almost impossible to ship a silent auto-approve.

## Examples

```typescript
// server/services/receipt-validation.ts

const HAS_APPLE_CREDENTIALS = !!(
  process.env.APPLE_ISSUER_ID &&
  process.env.APPLE_KEY_ID &&
  process.env.APPLE_PRIVATE_KEY
);

const HAS_GOOGLE_CREDENTIALS = !!(
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
  process.env.GOOGLE_SERVICE_ACCOUNT_KEY
);

/**
 * Layer 1: Explicit opt-in via RECEIPT_VALIDATION_STUB=true
 * Layer 2: No platform credentials configured
 * Layer 3: NODE_ENV check inside the handler (reject in production)
 */
const STUB_MODE =
  process.env.RECEIPT_VALIDATION_STUB === "true" &&
  !HAS_APPLE_CREDENTIALS &&
  !HAS_GOOGLE_CREDENTIALS;

export async function validateReceipt(
  receipt: string,
  platform: Platform,
): Promise<ReceiptValidationResult> {
  if (STUB_MODE) {
    // Layer 3: Even if STUB_MODE, reject in production
    if (process.env.NODE_ENV === "production") {
      console.error(
        "Receipt validation is stubbed in production — rejecting. " +
          "Configure Apple/Google credentials to enable.",
      );
      return { valid: false, errorCode: "NOT_IMPLEMENTED" };
    }
    console.warn("Receipt validation is stubbed — auto-approving in dev.");
    return { valid: true, expiresAt: oneYearFromNow() };
  }

  // Real implementation when credentials are available
  return platform === "ios"
    ? validateAppleReceipt(receipt)
    : validateGoogleReceipt(receipt);
}
```

```typescript
// Bad: Auto-activates from credential absence — silent auto-approve in dev
const STUB_MODE = !process.env.APPLE_SHARED_SECRET;

// Bad: Boolean flag with no production protection
const USE_STUB = true; // Developer forgets to change before deploy
export async function validateReceipt(...) {
  if (USE_STUB) return { valid: true }; // Auto-approves in production!
}
```

## Key elements

1. **Require explicit opt-in** (`RECEIPT_VALIDATION_STUB=true`), not just credential absence — prevents accidental auto-approve when credentials are simply missing
2. **Three-layer defense**: explicit env var + credential absence + production NODE_ENV rejection
3. **Log loudly**: `console.error` in production, `console.warn` in dev
4. **Return failure, not success** when stubbed in production

## When to use

- Payment / receipt validation (App Store, Google Play)
- Push notification services (APNs, FCM)
- SMS / email verification services
- Any third-party service requiring production-only credentials

## Related Files

- `server/services/receipt-validation.ts`

## See Also

- [Service availability guard checkAiConfigured](service-availability-guard-check-ai-configured-2026-05-13.md)
