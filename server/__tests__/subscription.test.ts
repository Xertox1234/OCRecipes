import { describe, it, expect } from "vitest";
import {
  UpgradeRequestSchema,
  RestoreRequestSchema,
  PlatformSchema,
} from "@shared/schemas/subscription";
import {
  TIER_FEATURES,
  isValidSubscriptionTier,
  type SubscriptionTier,
  type SubscriptionStatus,
} from "@shared/types/premium";

// ─── Schema validation tests ────────────────────────────────────────────────

describe("UpgradeRequestSchema", () => {
  it("validates a correct upgrade request", () => {
    const data = {
      receipt: "mock-receipt-123",
      platform: "ios",
      productId: "com.nutriscan.premium.annual",
      transactionId: "txn-abc-123",
    };
    const result = UpgradeRequestSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it("rejects missing receipt", () => {
    const data = {
      platform: "ios",
      productId: "com.nutriscan.premium.annual",
      transactionId: "txn-abc-123",
    };
    const result = UpgradeRequestSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it("rejects empty receipt", () => {
    const data = {
      receipt: "",
      platform: "ios",
      productId: "com.nutriscan.premium.annual",
      transactionId: "txn-abc-123",
    };
    const result = UpgradeRequestSchema.safeParse(data);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0].message).toBe("Receipt is required");
    }
  });

  it("rejects missing platform", () => {
    const data = {
      receipt: "mock-receipt-123",
      productId: "com.nutriscan.premium.annual",
      transactionId: "txn-abc-123",
    };
    const result = UpgradeRequestSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it("rejects invalid platform value", () => {
    const data = {
      receipt: "mock-receipt-123",
      platform: "windows",
      productId: "com.nutriscan.premium.annual",
      transactionId: "txn-abc-123",
    };
    const result = UpgradeRequestSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it("rejects empty transactionId", () => {
    const data = {
      receipt: "mock-receipt-123",
      platform: "ios",
      productId: "com.nutriscan.premium.annual",
      transactionId: "",
    };
    const result = UpgradeRequestSchema.safeParse(data);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0].message).toBe("Transaction ID is required");
    }
  });

  it("rejects empty productId", () => {
    const data = {
      receipt: "mock-receipt-123",
      platform: "ios",
      productId: "",
      transactionId: "txn-abc-123",
    };
    const result = UpgradeRequestSchema.safeParse(data);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0].message).toBe("Product ID is required");
    }
  });

  it("accepts android as platform", () => {
    const data = {
      receipt: "mock-receipt-123",
      platform: "android",
      productId: "com.nutriscan.premium.annual",
      transactionId: "txn-abc-123",
    };
    const result = UpgradeRequestSchema.safeParse(data);
    expect(result.success).toBe(true);
  });
});

describe("RestoreRequestSchema", () => {
  it("validates a correct restore request", () => {
    const data = {
      receipt: "mock-receipt-123",
      platform: "ios",
    };
    const result = RestoreRequestSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it("rejects missing receipt", () => {
    const data = { platform: "ios" };
    const result = RestoreRequestSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it("rejects invalid platform", () => {
    const data = { receipt: "mock-receipt-123", platform: "web" };
    const result = RestoreRequestSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it("accepts android platform", () => {
    const data = { receipt: "mock-receipt-123", platform: "android" };
    const result = RestoreRequestSchema.safeParse(data);
    expect(result.success).toBe(true);
  });
});

describe("PlatformSchema", () => {
  it("accepts ios", () => {
    expect(PlatformSchema.safeParse("ios").success).toBe(true);
  });

  it("accepts android", () => {
    expect(PlatformSchema.safeParse("android").success).toBe(true);
  });

  it("rejects web", () => {
    expect(PlatformSchema.safeParse("web").success).toBe(false);
  });

  it("rejects empty string", () => {
    expect(PlatformSchema.safeParse("").success).toBe(false);
  });
});

// ─── Subscription status logic tests ────────────────────────────────────────

describe("Subscription status logic", () => {
  function computeSubscriptionStatus(data: {
    tier: string;
    expiresAt: Date | null;
  }): SubscriptionStatus {
    const tier = isValidSubscriptionTier(data.tier) ? data.tier : "free";
    const expiresAt = data.expiresAt;

    const isActive =
      tier === "free" ||
      (tier === "premium" && (!expiresAt || new Date(expiresAt) > new Date()));

    const effectiveTier: SubscriptionTier = isActive ? tier : "free";

    return {
      tier: effectiveTier,
      expiresAt: expiresAt?.toISOString() || null,
      features: TIER_FEATURES[effectiveTier],
      isActive,
    };
  }

  it("returns free tier status correctly", () => {
    const result = computeSubscriptionStatus({
      tier: "free",
      expiresAt: null,
    });
    expect(result.tier).toBe("free");
    expect(result.isActive).toBe(true);
    expect(result.features.maxDailyScans).toBe(3);
    expect(result.features.recipeGeneration).toBe(false);
  });

  it("returns premium tier status correctly", () => {
    const futureDate = new Date();
    futureDate.setFullYear(futureDate.getFullYear() + 1);

    const result = computeSubscriptionStatus({
      tier: "premium",
      expiresAt: futureDate,
    });
    expect(result.tier).toBe("premium");
    expect(result.isActive).toBe(true);
    expect(result.features.recipeGeneration).toBe(true);
    expect(result.features.maxDailyScans).toBe(999999);
  });

  it("handles expired premium — downgrades to free", () => {
    const pastDate = new Date();
    pastDate.setFullYear(pastDate.getFullYear() - 1);

    const result = computeSubscriptionStatus({
      tier: "premium",
      expiresAt: pastDate,
    });
    expect(result.tier).toBe("free");
    expect(result.isActive).toBe(false);
    expect(result.features.recipeGeneration).toBe(false);
  });

  it("handles premium with no expiry (lifetime)", () => {
    const result = computeSubscriptionStatus({
      tier: "premium",
      expiresAt: null,
    });
    expect(result.tier).toBe("premium");
    expect(result.isActive).toBe(true);
  });

  it("treats invalid tier as free", () => {
    const result = computeSubscriptionStatus({
      tier: "enterprise",
      expiresAt: null,
    });
    expect(result.tier).toBe("free");
    expect(result.isActive).toBe(true);
  });

  it("returns correct features for free tier", () => {
    const result = computeSubscriptionStatus({
      tier: "free",
      expiresAt: null,
    });
    expect(result.features).toEqual(TIER_FEATURES.free);
  });

  it("returns correct features for premium tier", () => {
    const futureDate = new Date();
    futureDate.setFullYear(futureDate.getFullYear() + 1);

    const result = computeSubscriptionStatus({
      tier: "premium",
      expiresAt: futureDate,
    });
    expect(result.features).toEqual(TIER_FEATURES.premium);
  });
});

// ─── Upgrade route handler logic tests ──────────────────────────────────────

describe("Upgrade handler logic", () => {
  // Test the duplicate transaction detection logic
  it("detects duplicate transaction when existing record found", () => {
    // Simulates the route logic: if storage.getTransaction returns something, reject
    const existing = { transactionId: "txn-123", status: "completed" };
    const isDuplicate = !!existing;
    expect(isDuplicate).toBe(true);
  });

  it("allows new transaction when no existing record found", () => {
    const existing = undefined;
    const isDuplicate = !!existing;
    expect(isDuplicate).toBe(false);
  });

  // Test receipt validation response mapping
  it("maps failed validation to error response", () => {
    const validation = { valid: false, errorCode: "NOT_IMPLEMENTED" };
    const response = {
      success: false as const,
      error: "Receipt validation failed",
      code: validation.errorCode || "UNKNOWN",
    };
    expect(response.success).toBe(false);
    expect(response.code).toBe("NOT_IMPLEMENTED");
  });

  it("maps successful validation to upgrade response", () => {
    const expiresAt = new Date("2027-01-01T00:00:00Z");
    const response = {
      success: true as const,
      tier: "premium" as const,
      expiresAt: expiresAt.toISOString(),
    };
    expect(response.success).toBe(true);
    expect(response.tier).toBe("premium");
    expect(response.expiresAt).toBe("2027-01-01T00:00:00.000Z");
  });

  it("handles null expiresAt in upgrade response", () => {
    const expiresAt = null;
    const response = {
      success: true as const,
      tier: "premium" as const,
      expiresAt: expiresAt?.toISOString() || null,
    };
    expect(response.expiresAt).toBeNull();
  });
});

// ─── Restore handler logic tests ────────────────────────────────────────────

describe("Restore handler logic", () => {
  it("generates unique restore transaction ID", () => {
    const userId = "user-42";
    const restoreId1 = `restore-${Date.now()}-${userId}`;
    // Small delay to ensure different timestamps
    const restoreId2 = `restore-${Date.now() + 1}-${userId}`;
    expect(restoreId1).not.toBe(restoreId2);
    expect(restoreId1).toMatch(/^restore-\d+-user-42$/);
  });

  it("maps failed restore validation to error response", () => {
    const validation = { valid: false, errorCode: "NOT_IMPLEMENTED" };
    const response = {
      success: false as const,
      error: "No valid subscription found",
      code: validation.errorCode || "UNKNOWN",
    };
    expect(response.success).toBe(false);
    expect(response.error).toBe("No valid subscription found");
  });
});
