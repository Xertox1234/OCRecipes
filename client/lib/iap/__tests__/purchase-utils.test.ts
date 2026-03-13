import { describe, it, expect } from "vitest";
import {
  mapIAPError,
  isSupportedPlatform,
  buildReceiptPayload,
  buildRestorePayload,
} from "../purchase-utils";

describe("mapIAPError", () => {
  it("maps user-cancelled errors", () => {
    const result = mapIAPError(new Error("user-cancelled"));
    expect(result.code).toBe("USER_CANCELLED");
    expect(result.message).toBe("Purchase cancelled");
  });

  it("maps 'user cancelled' variant", () => {
    const result = mapIAPError(new Error("User Cancelled the purchase"));
    expect(result.code).toBe("USER_CANCELLED");
  });

  it("maps network errors", () => {
    const result = mapIAPError(new Error("Network timeout occurred"));
    expect(result.code).toBe("NETWORK");
    expect(result.originalError).toBeInstanceOf(Error);
  });

  it("maps timeout errors", () => {
    const result = mapIAPError(new Error("Request timeout"));
    expect(result.code).toBe("NETWORK");
  });

  it("maps already-owned errors", () => {
    const result = mapIAPError(new Error("Item already-owned"));
    expect(result.code).toBe("ALREADY_OWNED");
  });

  it("maps 'already owned' variant", () => {
    const result = mapIAPError(new Error("Already owned subscription"));
    expect(result.code).toBe("ALREADY_OWNED");
  });

  it("maps unavailable errors", () => {
    const result = mapIAPError(new Error("Store unavailable"));
    expect(result.code).toBe("STORE_UNAVAILABLE");
  });

  it("maps 'not available' variant", () => {
    const result = mapIAPError(new Error("Not available in this region"));
    expect(result.code).toBe("STORE_UNAVAILABLE");
  });

  it("maps unknown Error instances", () => {
    const err = new Error("Something went wrong");
    const result = mapIAPError(err);
    expect(result.code).toBe("UNKNOWN");
    expect(result.message).toBe("Something went wrong");
    expect(result.originalError).toBe(err);
  });

  it("maps non-Error values", () => {
    const result = mapIAPError("string error");
    expect(result.code).toBe("UNKNOWN");
    expect(result.message).toBe("An unexpected error occurred");
    expect(result.originalError).toBe("string error");
  });

  it("maps null/undefined", () => {
    expect(mapIAPError(null).code).toBe("UNKNOWN");
    expect(mapIAPError(undefined).code).toBe("UNKNOWN");
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

describe("buildReceiptPayload", () => {
  it("builds correct upgrade request shape", () => {
    const purchase = {
      transactionReceipt: "receipt-data-123",
      productId: "com.ocrecipes.premium.monthly",
      transactionId: "txn-456",
    };

    const result = buildReceiptPayload(purchase, "ios");

    expect(result).toEqual({
      receipt: "receipt-data-123",
      platform: "ios",
      productId: "com.ocrecipes.premium.monthly",
      transactionId: "txn-456",
    });
  });

  it("works with android platform", () => {
    const purchase = {
      transactionReceipt: "android-receipt",
      productId: "premium_yearly",
      transactionId: "txn-789",
    };

    const result = buildReceiptPayload(purchase, "android");
    expect(result.platform).toBe("android");
  });
});

describe("buildRestorePayload", () => {
  it("builds correct restore request shape", () => {
    const result = buildRestorePayload("restore-receipt-data", "ios");

    expect(result).toEqual({
      receipt: "restore-receipt-data",
      platform: "ios",
    });
  });

  it("works with android platform", () => {
    const result = buildRestorePayload("android-restore", "android");
    expect(result.platform).toBe("android");
    expect(result.receipt).toBe("android-restore");
  });
});
