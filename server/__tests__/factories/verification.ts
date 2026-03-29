import type {
  BarcodeVerification,
  VerificationHistoryEntry,
  ReformulationFlag,
  ApiKey,
  ApiKeyUsage,
  BarcodeNutrition,
} from "@shared/schema";

const barcodeVerificationDefaults: BarcodeVerification = {
  id: 1,
  barcode: "0123456789",
  verificationLevel: "unverified",
  consensusNutritionData: null,
  verificationCount: 0,
  frontLabelData: null,
  createdAt: new Date("2024-01-01"),
  updatedAt: new Date("2024-01-01"),
};

export function createMockBarcodeVerification(
  overrides: Partial<BarcodeVerification> = {},
): BarcodeVerification {
  return { ...barcodeVerificationDefaults, ...overrides };
}

const verificationHistoryDefaults: VerificationHistoryEntry = {
  id: 1,
  barcode: "0123456789",
  userId: "1",
  extractedNutrition: {},
  ocrConfidence: "0.95",
  isMatch: null,
  frontLabelScanned: false,
  frontLabelScannedAt: null,
  createdAt: new Date("2024-01-01"),
};

export function createMockVerificationHistory(
  overrides: Partial<VerificationHistoryEntry> = {},
): VerificationHistoryEntry {
  return { ...verificationHistoryDefaults, ...overrides };
}

const reformulationFlagDefaults: ReformulationFlag = {
  id: 1,
  barcode: "0123456789",
  status: "flagged",
  divergentScanCount: 0,
  previousConsensus: null,
  previousVerificationLevel: null,
  previousVerificationCount: null,
  detectedAt: new Date("2024-01-01"),
  resolvedAt: null,
};

export function createMockReformulationFlag(
  overrides: Partial<ReformulationFlag> = {},
): ReformulationFlag {
  return { ...reformulationFlagDefaults, ...overrides };
}

const apiKeyDefaults: ApiKey = {
  id: 1,
  keyPrefix: "ocr_test_abc",
  keyHash: "$2b$10$hashedkey",
  name: "Test API Key",
  tier: "free",
  status: "active",
  ownerId: "1",
  createdAt: new Date("2024-01-01"),
  revokedAt: null,
};

export function createMockApiKey(overrides: Partial<ApiKey> = {}): ApiKey {
  return { ...apiKeyDefaults, ...overrides };
}

const apiKeyUsageDefaults: ApiKeyUsage = {
  id: 1,
  apiKeyId: 1,
  yearMonth: "2024-01",
  requestCount: 0,
  lastRequestAt: null,
};

export function createMockApiKeyUsage(
  overrides: Partial<ApiKeyUsage> = {},
): ApiKeyUsage {
  return { ...apiKeyUsageDefaults, ...overrides };
}

const barcodeNutritionDefaults: BarcodeNutrition = {
  id: 1,
  barcode: "0123456789",
  productName: null,
  brandName: null,
  servingSize: null,
  calories: null,
  protein: null,
  carbs: null,
  fat: null,
  source: "usda",
  createdAt: new Date("2024-01-01"),
  updatedAt: new Date("2024-01-01"),
};

export function createMockBarcodeNutrition(
  overrides: Partial<BarcodeNutrition> = {},
): BarcodeNutrition {
  return { ...barcodeNutritionDefaults, ...overrides };
}
