import { describe, it, expect } from "vitest";
import {
  mapIAPError,
  buildReceiptPayload,
  buildRestorePayload,
  isSupportedPlatform,
} from "../purchase-utils";
import type { PurchaseError } from "@shared/types/subscription";

describe("mapIAPError", () => {
  it("maps user-cancelled error to USER_CANCELLED code", () => {
    const error = new Error("user-cancelled");
    const result = mapIAPError(error);
    expect(result.code).toBe("USER_CANCELLED");
    expect(result.message).toBe("Purchase cancelled");
  });

  it("maps 'User cancelled' message to USER_CANCELLED code", () => {
    const error = new Error("User cancelled the purchase");
    const result = mapIAPError(error);
    expect(result.code).toBe("USER_CANCELLED");
  });

  it("maps network error to NETWORK code", () => {
    const error = new Error("Network request failed");
    const result = mapIAPError(error);
    expect(result.code).toBe("NETWORK");
    expect(result.originalError).toBe(error);
  });

  it("maps timeout error to NETWORK code", () => {
    const error = new Error("Request timeout");
    const result = mapIAPError(error);
    expect(result.code).toBe("NETWORK");
  });

  it("maps already-owned error to ALREADY_OWNED code", () => {
    const error = new Error("already-owned");
    const result = mapIAPError(error);
    expect(result.code).toBe("ALREADY_OWNED");
  });

  it("maps 'already owned' message to ALREADY_OWNED code", () => {
    const error = new Error("Item already owned by user");
    const result = mapIAPError(error);
    expect(result.code).toBe("ALREADY_OWNED");
  });

  it("maps store unavailable error to STORE_UNAVAILABLE code", () => {
    const error = new Error("Store is unavailable");
    const result = mapIAPError(error);
    expect(result.code).toBe("STORE_UNAVAILABLE");
  });

  it("maps 'not available' error to STORE_UNAVAILABLE code", () => {
    const error = new Error("Billing service not available");
    const result = mapIAPError(error);
    expect(result.code).toBe("STORE_UNAVAILABLE");
  });

  it("maps unknown Error to UNKNOWN code with original message", () => {
    const error = new Error("Something weird happened");
    const result = mapIAPError(error);
    expect(result.code).toBe("UNKNOWN");
    expect(result.message).toBe("Something weird happened");
    expect(result.originalError).toBe(error);
  });

  it("maps non-Error value to UNKNOWN code", () => {
    const result = mapIAPError("string error");
    expect(result.code).toBe("UNKNOWN");
    expect(result.message).toBe("An unexpected error occurred");
    expect(result.originalError).toBe("string error");
  });

  it("maps null to UNKNOWN code", () => {
    const result = mapIAPError(null);
    expect(result.code).toBe("UNKNOWN");
  });

  it("maps undefined to UNKNOWN code", () => {
    const result = mapIAPError(undefined);
    expect(result.code).toBe("UNKNOWN");
  });

  it("returns a valid PurchaseError shape for every mapping", () => {
    const testCases = [
      new Error("user-cancelled"),
      new Error("network failure"),
      new Error("already-owned"),
      new Error("not available"),
      new Error("other"),
      42,
    ];

    for (const input of testCases) {
      const result: PurchaseError = mapIAPError(input);
      expect(result).toHaveProperty("code");
      expect(result).toHaveProperty("message");
      expect(typeof result.code).toBe("string");
      expect(typeof result.message).toBe("string");
    }
  });
});

describe("buildReceiptPayload", () => {
  it("builds correct payload structure", () => {
    const purchase = {
      transactionReceipt: "receipt-data-123",
      productId: "com.ocrecipes.premium.annual",
      transactionId: "txn-456",
    };

    const payload = buildReceiptPayload(purchase, "ios");

    expect(payload).toEqual({
      receipt: "receipt-data-123",
      platform: "ios",
      productId: "com.ocrecipes.premium.annual",
      transactionId: "txn-456",
    });
  });

  it("maps transactionReceipt to receipt field", () => {
    const purchase = {
      transactionReceipt: "my-receipt",
      productId: "prod-1",
      transactionId: "txn-1",
    };

    const payload = buildReceiptPayload(purchase, "android");
    expect(payload.receipt).toBe("my-receipt");
    expect(payload.platform).toBe("android");
  });

  it("preserves productId and transactionId", () => {
    const purchase = {
      transactionReceipt: "r",
      productId: "com.test.product",
      transactionId: "txn-test-123",
    };

    const payload = buildReceiptPayload(purchase, "ios");
    expect(payload.productId).toBe("com.test.product");
    expect(payload.transactionId).toBe("txn-test-123");
  });
});

describe("isSupportedPlatform", () => {
  it("returns true for ios", () => {
    expect(isSupportedPlatform("ios")).toBe(true);
  });

  it("returns true for android", () => {
    expect(isSupportedPlatform("android")).toBe(true);
  });

  it("returns false for web", () => {
    expect(isSupportedPlatform("web")).toBe(false);
  });

  it("returns false for windows", () => {
    expect(isSupportedPlatform("windows")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isSupportedPlatform("")).toBe(false);
  });
});

describe("buildRestorePayload", () => {
  it("builds correct restore payload for ios", () => {
    const payload = buildRestorePayload("restore-receipt-123", "ios");
    expect(payload).toEqual({
      receipt: "restore-receipt-123",
      platform: "ios",
    });
  });

  it("builds correct restore payload for android", () => {
    const payload = buildRestorePayload("android-receipt", "android");
    expect(payload).toEqual({
      receipt: "android-receipt",
      platform: "android",
    });
  });
});
