import {
  TIER_FEATURES,
  UNLIMITED_SCANS,
  type SubscriptionTier,
} from "@shared/types/premium";
import {
  FREE_BARCODE_TYPES,
  PREMIUM_BARCODE_TYPES,
  getBarcodeTypesForTier,
  isPremiumBarcodeType,
} from "@shared/types/camera";

// Import hooks after mocking
import {
  usePremiumFeature,
  useAvailableBarcodeTypes,
  useCanUseBarcodeType,
  useCanScanToday,
  usePremiumCamera,
} from "../usePremiumFeatures";

// Mock the PremiumContext module
const mockUsePremiumContext = vi.fn();
vi.mock("@/context/PremiumContext", () => ({
  usePremiumContext: () => mockUsePremiumContext(),
}));

describe("usePremiumFeatures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("usePremiumFeature", () => {
    it("should return true for enabled boolean features", () => {
      mockUsePremiumContext.mockReturnValue({
        features: TIER_FEATURES.premium,
      });

      expect(usePremiumFeature("advancedBarcodes")).toBe(true);
      expect(usePremiumFeature("highQualityCapture")).toBe(true);
      expect(usePremiumFeature("videoRecording")).toBe(true);
    });

    it("should return false for disabled boolean features", () => {
      mockUsePremiumContext.mockReturnValue({
        features: TIER_FEATURES.free,
      });

      expect(usePremiumFeature("advancedBarcodes")).toBe(false);
      expect(usePremiumFeature("highQualityCapture")).toBe(false);
      expect(usePremiumFeature("videoRecording")).toBe(false);
    });

    it("should return true for numeric features > 0", () => {
      mockUsePremiumContext.mockReturnValue({
        features: { ...TIER_FEATURES.free, maxDailyScans: 10 },
      });

      expect(usePremiumFeature("maxDailyScans")).toBe(true);
    });

    it("should return true for unlimited maxDailyScans (premium)", () => {
      mockUsePremiumContext.mockReturnValue({
        features: TIER_FEATURES.premium,
      });

      expect(usePremiumFeature("maxDailyScans")).toBe(true);
    });
  });

  describe("useAvailableBarcodeTypes", () => {
    it("should return only free barcode types for free tier", () => {
      mockUsePremiumContext.mockReturnValue({
        tier: "free" as SubscriptionTier,
      });

      const types = useAvailableBarcodeTypes();

      expect(types).toEqual(FREE_BARCODE_TYPES);
      expect(types).not.toContain("qr");
      expect(types).not.toContain("datamatrix");
    });

    it("should return all barcode types for premium tier", () => {
      mockUsePremiumContext.mockReturnValue({
        tier: "premium" as SubscriptionTier,
      });

      const types = useAvailableBarcodeTypes();

      expect(types).toEqual([...FREE_BARCODE_TYPES, ...PREMIUM_BARCODE_TYPES]);
      expect(types).toContain("qr");
      expect(types).toContain("datamatrix");
      expect(types).toContain("ean13");
    });
  });

  describe("useCanUseBarcodeType", () => {
    it("should allow free barcode types for free users", () => {
      mockUsePremiumContext.mockReturnValue({
        isPremium: false,
      });

      expect(useCanUseBarcodeType("ean13")).toBe(true);
      expect(useCanUseBarcodeType("upc_a")).toBe(true);
      expect(useCanUseBarcodeType("code128")).toBe(true);
    });

    it("should block premium barcode types for free users", () => {
      mockUsePremiumContext.mockReturnValue({
        isPremium: false,
      });

      expect(useCanUseBarcodeType("qr")).toBe(false);
      expect(useCanUseBarcodeType("datamatrix")).toBe(false);
    });

    it("should allow all barcode types for premium users", () => {
      mockUsePremiumContext.mockReturnValue({
        isPremium: true,
      });

      expect(useCanUseBarcodeType("ean13")).toBe(true);
      expect(useCanUseBarcodeType("qr")).toBe(true);
      expect(useCanUseBarcodeType("datamatrix")).toBe(true);
    });
  });

  describe("useCanScanToday", () => {
    it("should return canScan true when under limit", () => {
      mockUsePremiumContext.mockReturnValue({
        features: TIER_FEATURES.free,
        isPremium: false,
        dailyScanCount: 5,
        canScanToday: true,
      });

      const result = useCanScanToday();

      expect(result.canScan).toBe(true);
      expect(result.remainingScans).toBe(5); // 10 - 5
      expect(result.dailyLimit).toBe(10);
      expect(result.currentCount).toBe(5);
    });

    it("should return canScan false when at limit", () => {
      mockUsePremiumContext.mockReturnValue({
        features: TIER_FEATURES.free,
        isPremium: false,
        dailyScanCount: 10,
        canScanToday: false,
      });

      const result = useCanScanToday();

      expect(result.canScan).toBe(false);
      expect(result.remainingScans).toBe(0);
      expect(result.currentCount).toBe(10);
    });

    it("should return canScan false when over limit", () => {
      mockUsePremiumContext.mockReturnValue({
        features: TIER_FEATURES.free,
        isPremium: false,
        dailyScanCount: 15,
        canScanToday: false,
      });

      const result = useCanScanToday();

      expect(result.canScan).toBe(false);
      expect(result.remainingScans).toBe(0); // Max at 0, not negative
    });

    it("should return null remainingScans for premium users", () => {
      mockUsePremiumContext.mockReturnValue({
        features: TIER_FEATURES.premium,
        isPremium: true,
        dailyScanCount: 100,
        canScanToday: true,
      });

      const result = useCanScanToday();

      expect(result.canScan).toBe(true);
      expect(result.remainingScans).toBeNull();
      expect(result.dailyLimit).toBe(UNLIMITED_SCANS);
    });
  });

  describe("usePremiumCamera", () => {
    it("should return correct values for free tier", () => {
      mockUsePremiumContext.mockReturnValue({
        features: TIER_FEATURES.free,
        isPremium: false,
        dailyScanCount: 3,
        canScanToday: true,
        tier: "free" as SubscriptionTier,
      });

      const result = usePremiumCamera();

      expect(result.availableBarcodeTypes).toEqual(FREE_BARCODE_TYPES);
      expect(result.canScan).toBe(true);
      expect(result.remainingScans).toBe(7); // 10 - 3
      expect(result.isPremium).toBe(false);
      expect(result.highQualityCapture).toBe(false);
      expect(result.videoRecording).toBe(false);
    });

    it("should return correct values for premium tier", () => {
      mockUsePremiumContext.mockReturnValue({
        features: TIER_FEATURES.premium,
        isPremium: true,
        dailyScanCount: 50,
        canScanToday: true,
        tier: "premium" as SubscriptionTier,
      });

      const result = usePremiumCamera();

      expect(result.availableBarcodeTypes).toEqual([
        ...FREE_BARCODE_TYPES,
        ...PREMIUM_BARCODE_TYPES,
      ]);
      expect(result.canScan).toBe(true);
      expect(result.remainingScans).toBeNull();
      expect(result.isPremium).toBe(true);
      expect(result.highQualityCapture).toBe(true);
      expect(result.videoRecording).toBe(true);
    });

    it("should handle edge case of exactly at limit", () => {
      mockUsePremiumContext.mockReturnValue({
        features: TIER_FEATURES.free,
        isPremium: false,
        dailyScanCount: 10,
        canScanToday: false,
        tier: "free" as SubscriptionTier,
      });

      const result = usePremiumCamera();

      expect(result.canScan).toBe(false);
      expect(result.remainingScans).toBe(0);
    });
  });
});

// Additional tests for the underlying utility functions
describe("Camera type utilities", () => {
  describe("getBarcodeTypesForTier", () => {
    it("should return correct types for each tier", () => {
      expect(getBarcodeTypesForTier("free")).toEqual(FREE_BARCODE_TYPES);
      expect(getBarcodeTypesForTier("premium")).toEqual([
        ...FREE_BARCODE_TYPES,
        ...PREMIUM_BARCODE_TYPES,
      ]);
    });
  });

  describe("isPremiumBarcodeType", () => {
    it("should correctly identify premium types", () => {
      expect(isPremiumBarcodeType("qr")).toBe(true);
      expect(isPremiumBarcodeType("datamatrix")).toBe(true);
      expect(isPremiumBarcodeType("ean13")).toBe(false);
      expect(isPremiumBarcodeType("upc_a")).toBe(false);
    });
  });
});

describe("TIER_FEATURES configuration", () => {
  it("should have correct free tier limits", () => {
    expect(TIER_FEATURES.free.maxDailyScans).toBe(10);
    expect(TIER_FEATURES.free.advancedBarcodes).toBe(false);
    expect(TIER_FEATURES.free.highQualityCapture).toBe(false);
    expect(TIER_FEATURES.free.videoRecording).toBe(false);
  });

  it("should have correct premium tier features", () => {
    expect(TIER_FEATURES.premium.maxDailyScans).toBe(UNLIMITED_SCANS);
    expect(TIER_FEATURES.premium.advancedBarcodes).toBe(true);
    expect(TIER_FEATURES.premium.highQualityCapture).toBe(true);
    expect(TIER_FEATURES.premium.videoRecording).toBe(true);
  });
});
