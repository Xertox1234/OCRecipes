import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { JWSTransactionDecodedPayload } from "@apple/app-store-server-library";
import { VerificationStatus } from "@apple/app-store-server-library";

// Mock @apple/app-store-server-library
const mockVerifyAndDecodeTransaction = vi.fn();

vi.mock("@apple/app-store-server-library", async () => {
  const actual = await vi.importActual<
    typeof import("@apple/app-store-server-library")
  >("@apple/app-store-server-library");
  return {
    ...actual,
    SignedDataVerifier: class MockSignedDataVerifier {
      verifyAndDecodeTransaction = mockVerifyAndDecodeTransaction;
    },
  };
});

// Mock fs.readFileSync to avoid needing real cert files in tests
vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return {
    ...actual,
    default: {
      ...actual,
      readFileSync: vi.fn().mockReturnValue(Buffer.from("mock-cert")),
    },
    readFileSync: vi.fn().mockReturnValue(Buffer.from("mock-cert")),
  };
});

// Mock crypto.createSign to avoid needing a real RSA key in tests.
vi.mock("crypto", async () => {
  const actual = await vi.importActual<typeof import("crypto")>("crypto");
  return {
    ...actual,
    default: {
      ...actual,
      createSign: () => ({
        update: () => {},
        sign: () => "mock-signature",
      }),
    },
    createSign: () => ({
      update: () => {},
      sign: () => "mock-signature",
    }),
  };
});

// --- Helpers ---

/** Future date (1 year from now) as epoch ms. */
const FUTURE_EXPIRY = Date.now() + 365 * 24 * 60 * 60 * 1000;
/** Past date (1 year ago) as epoch ms. */
const PAST_EXPIRY = Date.now() - 365 * 24 * 60 * 60 * 1000;

/**
 * Setup helper for Google validation tests. Re-imports the module with fresh
 * env, resets the token cache, and mocks fetch with the given subscription response.
 * Returns the freshly imported `validateReceipt` function and the fetch spy.
 */
async function setupGoogleTest(subscriptionResponse: object, status = 200) {
  vi.resetModules();
  const mod = await import("../receipt-validation");
  mod.resetGoogleTokenCache();

  const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async (url) => {
    const urlStr = typeof url === "string" ? url : url.toString();
    if (urlStr.includes("oauth2.googleapis.com")) {
      return new Response(
        JSON.stringify({
          access_token: "mock-access-token",
          expires_in: 3600,
        }),
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

// --- Tests ---

describe("Receipt Validation", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    mockVerifyAndDecodeTransaction.mockReset();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("stub mode (no credentials)", () => {
    beforeEach(() => {
      delete process.env.APPLE_ISSUER_ID;
      delete process.env.APPLE_KEY_ID;
      delete process.env.APPLE_PRIVATE_KEY;
      delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
      delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    });

    it("auto-approves in development when RECEIPT_VALIDATION_STUB=true", async () => {
      process.env.NODE_ENV = "development";
      process.env.RECEIPT_VALIDATION_STUB = "true";

      vi.resetModules();
      const { validateReceipt: validate } = await import(
        "../receipt-validation"
      );

      const result = await validate("fake-receipt", "ios");
      expect(result.valid).toBe(true);
      expect(result.expiresAt).toBeDefined();
      expect(result.expiresAt!.getTime()).toBeGreaterThan(Date.now());
    });

    it("does NOT auto-approve when RECEIPT_VALIDATION_STUB is not set", async () => {
      process.env.NODE_ENV = "development";
      delete process.env.RECEIPT_VALIDATION_STUB;

      vi.resetModules();
      const { validateReceipt: validate } = await import(
        "../receipt-validation"
      );

      const result = await validate("fake-receipt", "ios");
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe("PLATFORM_NOT_CONFIGURED");
    });

    it("rejects in production even with RECEIPT_VALIDATION_STUB=true", async () => {
      process.env.NODE_ENV = "production";
      process.env.RECEIPT_VALIDATION_STUB = "true";

      vi.resetModules();
      const { validateReceipt: validate } = await import(
        "../receipt-validation"
      );

      const result = await validate("fake-receipt", "ios");
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe("NOT_IMPLEMENTED");
    });
  });

  describe("Apple receipt validation", () => {
    beforeEach(() => {
      process.env.APPLE_ISSUER_ID = "test-issuer";
      process.env.APPLE_KEY_ID = "test-key-id";
      process.env.APPLE_PRIVATE_KEY = "test-private-key";
      process.env.APPLE_BUNDLE_ID = "com.nutriscan.app";
    });

    it("validates a verified receipt with future expiry", async () => {
      mockVerifyAndDecodeTransaction.mockResolvedValue({
        productId: "premium_monthly",
        expiresDate: FUTURE_EXPIRY,
        originalTransactionId: "txn-123",
      } satisfies Partial<JWSTransactionDecodedPayload>);

      vi.resetModules();
      const { validateReceipt: validate, resetAppleVerifier } = await import(
        "../receipt-validation"
      );
      resetAppleVerifier();

      const result = await validate("signed-jws-receipt", "ios");
      expect(result.valid).toBe(true);
      expect(result.productId).toBe("premium_monthly");
      expect(result.originalTransactionId).toBe("txn-123");
      expect(result.expiresAt).toBeDefined();
    });

    it("rejects expired receipt", async () => {
      mockVerifyAndDecodeTransaction.mockResolvedValue({
        productId: "premium_monthly",
        expiresDate: PAST_EXPIRY,
      } satisfies Partial<JWSTransactionDecodedPayload>);

      vi.resetModules();
      const { validateReceipt: validate, resetAppleVerifier } = await import(
        "../receipt-validation"
      );
      resetAppleVerifier();

      const result = await validate("signed-jws-receipt", "ios");
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe("SUBSCRIPTION_EXPIRED");
    });

    it("rejects revoked receipt", async () => {
      mockVerifyAndDecodeTransaction.mockResolvedValue({
        productId: "premium_monthly",
        expiresDate: FUTURE_EXPIRY,
        revocationDate: Date.now(),
      } satisfies Partial<JWSTransactionDecodedPayload>);

      vi.resetModules();
      const { validateReceipt: validate, resetAppleVerifier } = await import(
        "../receipt-validation"
      );
      resetAppleVerifier();

      const result = await validate("signed-jws-receipt", "ios");
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe("TRANSACTION_REVOKED");
    });

    it("rejects product mismatch when productId is provided", async () => {
      mockVerifyAndDecodeTransaction.mockResolvedValue({
        productId: "wrong_product",
        expiresDate: FUTURE_EXPIRY,
      } satisfies Partial<JWSTransactionDecodedPayload>);

      vi.resetModules();
      const { validateReceipt: validate, resetAppleVerifier } = await import(
        "../receipt-validation"
      );
      resetAppleVerifier();

      const result = await validate(
        "signed-jws-receipt",
        "ios",
        "premium_monthly",
      );
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe("PRODUCT_MISMATCH");
    });

    it("rejects when signature verification fails (INVALID_CERTIFICATE)", async () => {
      const { VerificationException } = await import(
        "@apple/app-store-server-library"
      );
      mockVerifyAndDecodeTransaction.mockRejectedValue(
        new VerificationException(VerificationStatus.INVALID_CERTIFICATE),
      );

      vi.resetModules();
      const { validateReceipt: validate, resetAppleVerifier } = await import(
        "../receipt-validation"
      );
      resetAppleVerifier();

      const result = await validate("forged-jws-receipt", "ios");
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe("INVALID_CERTIFICATE");
    });

    it("rejects when environment mismatches (INVALID_ENVIRONMENT)", async () => {
      const { VerificationException } = await import(
        "@apple/app-store-server-library"
      );
      mockVerifyAndDecodeTransaction.mockRejectedValue(
        new VerificationException(VerificationStatus.INVALID_ENVIRONMENT),
      );

      vi.resetModules();
      const { validateReceipt: validate, resetAppleVerifier } = await import(
        "../receipt-validation"
      );
      resetAppleVerifier();

      const result = await validate("wrong-env-receipt", "ios");
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe("INVALID_ENVIRONMENT");
    });

    it("rejects when app identifier mismatches (INVALID_APP_IDENTIFIER)", async () => {
      const { VerificationException } = await import(
        "@apple/app-store-server-library"
      );
      mockVerifyAndDecodeTransaction.mockRejectedValue(
        new VerificationException(VerificationStatus.INVALID_APP_IDENTIFIER),
      );

      vi.resetModules();
      const { validateReceipt: validate, resetAppleVerifier } = await import(
        "../receipt-validation"
      );
      resetAppleVerifier();

      const result = await validate("wrong-bundle-receipt", "ios");
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe("BUNDLE_MISMATCH");
    });

    it("returns INVALID_RECEIPT for non-VerificationException errors", async () => {
      mockVerifyAndDecodeTransaction.mockRejectedValue(
        new Error("Network timeout"),
      );

      vi.resetModules();
      const { validateReceipt: validate, resetAppleVerifier } = await import(
        "../receipt-validation"
      );
      resetAppleVerifier();

      const result = await validate("bad-receipt", "ios");
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe("INVALID_RECEIPT");
    });

    it("accepts non-subscription purchase (no expiresDate)", async () => {
      mockVerifyAndDecodeTransaction.mockResolvedValue({
        productId: "lifetime_premium",
        originalTransactionId: "txn-456",
      } satisfies Partial<JWSTransactionDecodedPayload>);

      vi.resetModules();
      const { validateReceipt: validate, resetAppleVerifier } = await import(
        "../receipt-validation"
      );
      resetAppleVerifier();

      const result = await validate("signed-jws-receipt", "ios");
      expect(result.valid).toBe(true);
      expect(result.productId).toBe("lifetime_premium");
      expect(result.expiresAt).toBeUndefined();
    });
  });

  describe("Google receipt validation", () => {
    beforeEach(() => {
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL =
        "test@project.iam.gserviceaccount.com";
      process.env.GOOGLE_SERVICE_ACCOUNT_KEY =
        "-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----";
      process.env.GOOGLE_PACKAGE_NAME = "com.nutriscan.app";
    });

    it("validates an active Google subscription", async () => {
      const { validate, fetchSpy } = await setupGoogleTest({
        subscriptionState: "SUBSCRIPTION_STATE_ACTIVE",
        lineItems: [
          {
            productId: "premium_monthly",
            expiryTime: new Date(FUTURE_EXPIRY).toISOString(),
          },
        ],
      });

      const result = await validate("purchase-token-123", "android");
      expect(result.valid).toBe(true);
      expect(result.productId).toBe("premium_monthly");
      expect(result.expiresAt).toBeDefined();

      fetchSpy.mockRestore();
    });

    it("validates a subscription in grace period", async () => {
      const { validate, fetchSpy } = await setupGoogleTest({
        subscriptionState: "SUBSCRIPTION_STATE_IN_GRACE_PERIOD",
        lineItems: [
          {
            productId: "premium_monthly",
            expiryTime: new Date(FUTURE_EXPIRY).toISOString(),
          },
        ],
      });

      const result = await validate("purchase-token-123", "android");
      expect(result.valid).toBe(true);

      fetchSpy.mockRestore();
    });

    it("rejects expired Google subscription", async () => {
      const { validate, fetchSpy } = await setupGoogleTest({
        subscriptionState: "SUBSCRIPTION_STATE_EXPIRED",
        lineItems: [
          {
            productId: "premium_monthly",
            expiryTime: new Date(PAST_EXPIRY).toISOString(),
          },
        ],
      });

      const result = await validate("purchase-token-123", "android");
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe("SUBSCRIPTION_EXPIRED");

      fetchSpy.mockRestore();
    });

    it("rejects inactive Google subscription", async () => {
      const { validate, fetchSpy } = await setupGoogleTest({
        subscriptionState: "SUBSCRIPTION_STATE_CANCELED",
        lineItems: [{ productId: "premium_monthly" }],
      });

      const result = await validate("purchase-token-123", "android");
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe("PURCHASE_NOT_ACTIVE");

      fetchSpy.mockRestore();
    });

    it("rejects product mismatch on Google", async () => {
      const { validate, fetchSpy } = await setupGoogleTest({
        subscriptionState: "SUBSCRIPTION_STATE_ACTIVE",
        lineItems: [
          {
            productId: "wrong_product",
            expiryTime: new Date(FUTURE_EXPIRY).toISOString(),
          },
        ],
      });

      const result = await validate(
        "purchase-token-123",
        "android",
        "premium_monthly",
      );
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe("PRODUCT_MISMATCH");

      fetchSpy.mockRestore();
    });

    it("returns STORE_API_ERROR when Google API fails", async () => {
      vi.resetModules();
      const mod = await import("../receipt-validation");
      mod.resetGoogleTokenCache();

      const fetchSpy = vi
        .spyOn(global, "fetch")
        .mockImplementation(async (url) => {
          const urlStr = typeof url === "string" ? url : url.toString();
          if (urlStr.includes("oauth2.googleapis.com")) {
            return new Response(
              JSON.stringify({
                access_token: "mock-access-token",
                expires_in: 3600,
              }),
              { status: 200 },
            );
          }
          if (urlStr.includes("androidpublisher.googleapis.com")) {
            return new Response("Internal Server Error", { status: 500 });
          }
          throw new Error(`Unexpected fetch to ${urlStr}`);
        });

      const result = await mod.validateReceipt("purchase-token-123", "android");
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe("STORE_API_ERROR");

      fetchSpy.mockRestore();
    });

    it("returns STORE_API_ERROR when OAuth token fails", async () => {
      vi.resetModules();
      const mod = await import("../receipt-validation");
      mod.resetGoogleTokenCache();

      const fetchSpy = vi
        .spyOn(global, "fetch")
        .mockImplementation(async () => {
          return new Response("Unauthorized", { status: 401 });
        });

      const result = await mod.validateReceipt("purchase-token-123", "android");
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe("STORE_API_ERROR");

      fetchSpy.mockRestore();
    });
  });

  describe("platform not configured", () => {
    it("returns PLATFORM_NOT_CONFIGURED for iOS when only Google creds set", async () => {
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL =
        "test@project.iam.gserviceaccount.com";
      process.env.GOOGLE_SERVICE_ACCOUNT_KEY = "test-key";
      delete process.env.APPLE_ISSUER_ID;
      delete process.env.APPLE_KEY_ID;
      delete process.env.APPLE_PRIVATE_KEY;

      vi.resetModules();
      const { validateReceipt: validate } = await import(
        "../receipt-validation"
      );

      const result = await validate("some-receipt", "ios");
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe("PLATFORM_NOT_CONFIGURED");
    });

    it("returns PLATFORM_NOT_CONFIGURED for Android when only Apple creds set", async () => {
      process.env.APPLE_ISSUER_ID = "test-issuer";
      process.env.APPLE_KEY_ID = "test-key-id";
      process.env.APPLE_PRIVATE_KEY = "test-private-key";
      delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
      delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

      vi.resetModules();
      const { validateReceipt: validate } = await import(
        "../receipt-validation"
      );

      const result = await validate("some-token", "android");
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe("PLATFORM_NOT_CONFIGURED");
    });
  });
});
