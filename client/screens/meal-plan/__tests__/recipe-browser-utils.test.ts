import { describe, it, expect } from "vitest";
import {
  shouldGatePremiumSource,
  isQuotaExceededError,
  resolveOnlineCtaState,
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

describe("resolveOnlineCtaState", () => {
  const d = {
    catalogDisabled: false,
    isPremium: false,
    hasQuery: true,
    onlineRequested: false,
    onlineLoading: false,
    quotaExhausted: false,
  };
  it("hidden when catalog disabled or query empty", () => {
    expect(resolveOnlineCtaState({ ...d, catalogDisabled: true })).toBe(
      "hidden",
    );
    expect(resolveOnlineCtaState({ ...d, hasQuery: false })).toBe("hidden");
  });
  it("premium-locked for free users with a query", () => {
    expect(resolveOnlineCtaState(d)).toBe("premium-locked");
  });
  it("premium flow: actionable → loading → quota-exhausted", () => {
    expect(resolveOnlineCtaState({ ...d, isPremium: true })).toBe("actionable");
    expect(
      resolveOnlineCtaState({
        ...d,
        isPremium: true,
        onlineRequested: true,
        onlineLoading: true,
      }),
    ).toBe("loading");
    expect(
      resolveOnlineCtaState({
        ...d,
        isPremium: true,
        onlineRequested: true,
        quotaExhausted: true,
      }),
    ).toBe("quota-exhausted");
  });
});
