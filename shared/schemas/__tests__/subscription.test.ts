import {
  PlatformSchema,
  UpgradeRequestSchema,
  UpgradeResponseSchema,
} from "../subscription";

describe("PlatformSchema", () => {
  it("should accept ios", () => {
    expect(PlatformSchema.parse("ios")).toBe("ios");
  });

  it("should accept android", () => {
    expect(PlatformSchema.parse("android")).toBe("android");
  });

  it("should reject invalid platforms", () => {
    expect(() => PlatformSchema.parse("web")).toThrow();
    expect(() => PlatformSchema.parse("")).toThrow();
    expect(() => PlatformSchema.parse(123)).toThrow();
  });
});

describe("UpgradeRequestSchema", () => {
  const validRequest = {
    receipt: "receipt-data-123",
    platform: "ios",
    productId: "com.ocrecipes.premium.monthly",
    transactionId: "txn-abc-123",
  };

  it("should accept a valid request", () => {
    const result = UpgradeRequestSchema.parse(validRequest);
    expect(result).toEqual(validRequest);
  });

  it("should accept android platform", () => {
    const result = UpgradeRequestSchema.parse({
      ...validRequest,
      platform: "android",
    });
    expect(result.platform).toBe("android");
  });

  it("should reject missing receipt", () => {
    const { receipt, ...rest } = validRequest;
    expect(() => UpgradeRequestSchema.parse(rest)).toThrow();
  });

  it("should reject empty receipt", () => {
    expect(() =>
      UpgradeRequestSchema.parse({ ...validRequest, receipt: "" }),
    ).toThrow();
  });

  it("should reject missing platform", () => {
    const { platform, ...rest } = validRequest;
    expect(() => UpgradeRequestSchema.parse(rest)).toThrow();
  });

  it("should reject invalid platform", () => {
    expect(() =>
      UpgradeRequestSchema.parse({ ...validRequest, platform: "web" }),
    ).toThrow();
  });

  it("should reject missing productId", () => {
    const { productId, ...rest } = validRequest;
    expect(() => UpgradeRequestSchema.parse(rest)).toThrow();
  });

  it("should reject empty productId", () => {
    expect(() =>
      UpgradeRequestSchema.parse({ ...validRequest, productId: "" }),
    ).toThrow();
  });

  it("should reject missing transactionId", () => {
    const { transactionId, ...rest } = validRequest;
    expect(() => UpgradeRequestSchema.parse(rest)).toThrow();
  });

  it("should reject empty transactionId", () => {
    expect(() =>
      UpgradeRequestSchema.parse({ ...validRequest, transactionId: "" }),
    ).toThrow();
  });

  it("should reject extra fields silently (strip)", () => {
    const result = UpgradeRequestSchema.parse({
      ...validRequest,
      extraField: "should be ignored",
    });
    expect(result).not.toHaveProperty("extraField");
  });

  it("should reject non-string receipt", () => {
    expect(() =>
      UpgradeRequestSchema.parse({ ...validRequest, receipt: 123 }),
    ).toThrow();
  });

  it("should reject null values", () => {
    expect(() =>
      UpgradeRequestSchema.parse({ ...validRequest, receipt: null }),
    ).toThrow();
  });
});

describe("UpgradeResponseSchema", () => {
  it("should accept a success response", () => {
    const result = UpgradeResponseSchema.parse({
      success: true,
      tier: "premium",
      expiresAt: "2025-12-31T00:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("should accept a success response with null expiresAt", () => {
    const result = UpgradeResponseSchema.parse({
      success: true,
      tier: "premium",
      expiresAt: null,
    });
    expect(result.success).toBe(true);
  });

  it("should reject an invalid tier value", () => {
    expect(() =>
      UpgradeResponseSchema.parse({
        success: true,
        tier: "ultra",
        expiresAt: "2025-12-31T00:00:00.000Z",
      }),
    ).toThrow();
  });

  it("should accept a failure response with code", () => {
    const result = UpgradeResponseSchema.parse({
      success: false,
      error: "Receipt validation failed",
      code: "NETWORK",
    });
    expect(result.success).toBe(false);
  });

  it("should accept a failure response without code", () => {
    const result = UpgradeResponseSchema.parse({
      success: false,
      error: "Unknown error",
    });
    expect(result.success).toBe(false);
  });

  it("should reject success response missing tier", () => {
    expect(() =>
      UpgradeResponseSchema.parse({
        success: true,
        expiresAt: "2025-12-31T00:00:00.000Z",
      }),
    ).toThrow();
  });

  it("should reject failure response missing error", () => {
    expect(() =>
      UpgradeResponseSchema.parse({
        success: false,
      }),
    ).toThrow();
  });

  it("should reject response without success discriminator", () => {
    expect(() =>
      UpgradeResponseSchema.parse({
        tier: "premium",
        error: "something",
      }),
    ).toThrow();
  });
});
