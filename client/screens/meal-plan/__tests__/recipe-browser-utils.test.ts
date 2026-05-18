import { describe, it, expect } from "vitest";
import {
  shouldGatePremiumSource,
  isQuotaExceededError,
} from "../recipe-browser-utils";
import { ApiError } from "../../../lib/api-error";

describe("shouldGatePremiumSource", () => {
  it("gates a free user selecting the Online (spoonacular) source", () => {
    expect(shouldGatePremiumSource("spoonacular", false)).toBe(true);
  });

  it("does not gate a premium user selecting the Online source", () => {
    expect(shouldGatePremiumSource("spoonacular", true)).toBe(false);
  });

  it("does not gate a free user selecting a local source", () => {
    expect(shouldGatePremiumSource("all", false)).toBe(false);
    expect(shouldGatePremiumSource("personal", false)).toBe(false);
    expect(shouldGatePremiumSource("community", false)).toBe(false);
  });
});

describe("isQuotaExceededError", () => {
  it("detects the catalog quota-exceeded ApiError", () => {
    const error = new ApiError("402: quota", "CATALOG_QUOTA_EXCEEDED");
    expect(isQuotaExceededError(error)).toBe(true);
  });

  it("returns false for an ApiError with a different code", () => {
    const error = new ApiError("500: server error", "INTERNAL_ERROR");
    expect(isQuotaExceededError(error)).toBe(false);
  });

  it("returns false for a non-ApiError value", () => {
    expect(isQuotaExceededError(new Error("network"))).toBe(false);
    expect(isQuotaExceededError(null)).toBe(false);
    expect(isQuotaExceededError(undefined)).toBe(false);
  });
});
