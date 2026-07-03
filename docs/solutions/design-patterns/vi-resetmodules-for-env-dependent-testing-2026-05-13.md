---
title: '`vi.resetModules` + dynamic import for env-dependent module testing'
track: knowledge
category: design-patterns
module: server
tags: [testing, vitest, env, process-env, module-cache]
applies_to: [server/**/__tests__/**/*.ts]
created: '2026-05-13'
---

# `vi.resetModules` + dynamic import for env-dependent module testing

## When this applies

When a module evaluates environment variables at the top level (e.g., `const STUB_MODE = !process.env.X`), Vitest caches the module after the first import. Changing `process.env` in a later test has no effect because the cached module still has the old values baked into its constants. Use `vi.resetModules()` + dynamic `await import()` to get a fresh module evaluation with the current `process.env`.

## Why

Top-level `const X = !!process.env.Y` runs once at import time. Vitest's per-file module cache means the second test sees the same constants no matter what `process.env` says. `vi.resetModules()` evicts the cached module so the next `await import()` re-evaluates with the current environment.

## Examples

```typescript
describe("stub mode (no credentials)", () => {
  beforeEach(() => {
    delete process.env.APPLE_ISSUER_ID;
    delete process.env.APPLE_KEY_ID;
    delete process.env.APPLE_PRIVATE_KEY;
    delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv }; // Restore original env
  });

  it("auto-approves in development when RECEIPT_VALIDATION_STUB=true", async () => {
    process.env.NODE_ENV = "development";
    process.env.RECEIPT_VALIDATION_STUB = "true";

    vi.resetModules(); // Clear Vitest's module cache
    const { validateReceipt } = await import("../receipt-validation"); // Fresh import

    const result = await validateReceipt("fake-receipt", "ios");
    expect(result.valid).toBe(true);
  });

  it("does NOT auto-approve when RECEIPT_VALIDATION_STUB is not set", async () => {
    process.env.NODE_ENV = "development";
    delete process.env.RECEIPT_VALIDATION_STUB;

    vi.resetModules();
    const { validateReceipt } = await import("../receipt-validation");

    const result = await validateReceipt("fake-receipt", "ios");
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe("PLATFORM_NOT_CONFIGURED");
  });
});
```

For tests with repetitive setup (multiple env vars + fetch mocking), extract a setup helper:

```typescript
/**
 * Setup helper for Google validation tests. Re-imports module with fresh
 * env, resets caches, and mocks fetch with the given subscription response.
 */
async function setupGoogleTest(subscriptionResponse: object, status = 200) {
  vi.resetModules();
  const mod = await import("../receipt-validation");
  mod.resetGoogleTokenCache();

  const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async (url) => {
    const urlStr = typeof url === "string" ? url : url.toString();
    if (urlStr.includes("oauth2.googleapis.com")) {
      return new Response(
        JSON.stringify({ access_token: "mock", expires_in: 3600 }),
        { status: 200 },
      );
    }
    if (urlStr.includes("androidpublisher.googleapis.com")) {
      return new Response(JSON.stringify(subscriptionResponse), { status });
    }
    throw new Error(`Unexpected fetch to ${urlStr}`);
  });

  return { validate: mod.validateReceipt, fetchSpy };
}

// Usage — each test gets a fresh module with correct env
it("validates active subscription", async () => {
  const { validate, fetchSpy } = await setupGoogleTest({
    subscriptionState: "SUBSCRIPTION_STATE_ACTIVE",
    lineItems: [{ productId: "premium_monthly", expiryTime: futureDate }],
  });
  const result = await validate("token", "android");
  expect(result.valid).toBe(true);
  fetchSpy.mockRestore();
});
```

## When to use

- Testing modules that read `process.env` at the top level (module-scope `const` evaluated at import time)
- Testing different configurations of the same service (stub mode vs. real mode, different platform credentials)
- Any module with `const X = !!process.env.Y` or `const X = process.env.Y ?? "default"` at module scope

## Exceptions

- Modules that read env vars lazily inside functions (just set `process.env.X` before calling the function)
- Tests where a single env configuration is sufficient for the entire describe block

## Key pitfall

After `vi.resetModules()`, you must re-import the module with `await import()`. Any references to the old module's exports are stale. If the module also has internal caches (like token caches), export a `resetCache()` function and call it after re-import.

## Related Files

- `server/services/__tests__/receipt-validation.test.ts` — `setupGoogleTest()` helper and stub mode tests

## See Also

- [Mocking class constructors in `vi.mock`](mocking-class-constructors-vi-mock-2026-05-13.md)
- [Testing real express-rate-limit (bypass passthrough mock)](testing-real-express-rate-limit-bypass-passthrough-2026-05-13.md)
