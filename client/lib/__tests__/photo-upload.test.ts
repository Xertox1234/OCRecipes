import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  calculateTotals,
  uploadPhotoForAnalysis,
  lookupNutritionByPrep,
  submitFollowUp,
  confirmPhotoAnalysis,
  mapPhotoResultToImportedRecipeData,
  type FoodItem,
  type RecipePhotoResult,
} from "../photo-upload";
import { uploadAsync } from "expo-file-system/legacy";
import { tokenStorage } from "../token-storage";
import { compressImage, cleanupImage } from "../image-compression";

/**
 * We only test the pure `calculateTotals` function here.
 * The other exports (uploadPhoto, confirmPhoto) depend on expo-file-system
 * and other native modules, which are tested via integration tests.
 *
 * Mock all native-dependent imports to allow importing calculateTotals.
 */
vi.mock("expo-file-system/legacy", () => ({
  uploadAsync: vi.fn(),
  FileSystemUploadType: { MULTIPART: 0 },
}));

vi.mock("../token-storage", () => ({
  tokenStorage: { get: vi.fn() },
}));

vi.mock("../query-client", () => ({
  getApiUrl: vi.fn().mockReturnValue("http://localhost:3000"),
}));

vi.mock("../image-compression", () => ({
  compressImage: vi.fn(),
  cleanupImage: vi.fn(),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("calculateTotals", () => {
  const baseNutrition = {
    name: "Chicken",
    fiber: 0,
    sugar: 0,
    sodium: 100,
    servingSize: "100g",
    source: "usda" as const,
  };

  it("sums nutrition from multiple food items", () => {
    const foods: FoodItem[] = [
      {
        name: "Chicken",
        quantity: "200g",
        confidence: 0.9,
        needsClarification: false,
        nutrition: {
          ...baseNutrition,
          calories: 330,
          protein: 62,
          carbs: 0,
          fat: 7,
        },
      },
      {
        name: "Rice",
        quantity: "1 cup",
        confidence: 0.85,
        needsClarification: false,
        nutrition: {
          ...baseNutrition,
          name: "Rice",
          calories: 216,
          protein: 5,
          carbs: 45,
          fat: 2,
        },
      },
    ];

    const result = calculateTotals(foods);
    expect(result.calories).toBe(546);
    expect(result.protein).toBe(67);
    expect(result.carbs).toBe(45);
    expect(result.fat).toBe(9);
  });

  it("skips items without nutrition data", () => {
    const foods: FoodItem[] = [
      {
        name: "Chicken",
        quantity: "200g",
        confidence: 0.9,
        needsClarification: false,
        nutrition: {
          ...baseNutrition,
          calories: 330,
          protein: 62,
          carbs: 0,
          fat: 7,
        },
      },
      {
        name: "Unknown item",
        quantity: "1 serving",
        confidence: 0.3,
        needsClarification: true,
        nutrition: null,
      },
    ];

    const result = calculateTotals(foods);
    expect(result.calories).toBe(330);
    expect(result.protein).toBe(62);
  });

  it("returns zeros for empty array", () => {
    const result = calculateTotals([]);
    expect(result).toEqual({ calories: 0, protein: 0, carbs: 0, fat: 0 });
  });

  it("returns zeros when all items lack nutrition", () => {
    const foods: FoodItem[] = [
      {
        name: "Mystery food",
        quantity: "1 piece",
        confidence: 0.2,
        needsClarification: true,
        nutrition: null,
      },
    ];

    const result = calculateTotals(foods);
    expect(result).toEqual({ calories: 0, protein: 0, carbs: 0, fat: 0 });
  });

  it("handles single item", () => {
    const foods: FoodItem[] = [
      {
        name: "Apple",
        quantity: "1 medium",
        confidence: 0.95,
        needsClarification: false,
        nutrition: {
          ...baseNutrition,
          name: "Apple",
          calories: 95,
          protein: 0.5,
          carbs: 25,
          fat: 0.3,
        },
      },
    ];

    const result = calculateTotals(foods);
    expect(result.calories).toBe(95);
    expect(result.protein).toBe(0.5);
    expect(result.carbs).toBe(25);
    expect(result.fat).toBe(0.3);
  });
});

describe("uploadPhotoForAnalysis", () => {
  const mockAnalysisResponse = {
    sessionId: "sess-123",
    intent: "log",
    foods: [],
    overallConfidence: 0.9,
    needsFollowUp: false,
    followUpQuestions: [],
  };

  it("throws if not authenticated", async () => {
    vi.mocked(tokenStorage.get).mockResolvedValue(null);

    await expect(uploadPhotoForAnalysis("file:///photo.jpg")).rejects.toThrow(
      "Not authenticated",
    );
  });

  it("compresses, uploads, and returns parsed response on success", async () => {
    vi.mocked(tokenStorage.get).mockResolvedValue("test-token");
    vi.mocked(compressImage).mockResolvedValue({
      uri: "file:///compressed.jpg",
      width: 800,
      height: 600,
      sizeKB: 450,
    });
    vi.mocked(uploadAsync).mockResolvedValue({
      status: 200,
      body: JSON.stringify(mockAnalysisResponse),
      headers: {},
      mimeType: null,
    });

    const result = await uploadPhotoForAnalysis("file:///photo.jpg", "log");

    expect(compressImage).toHaveBeenCalledWith("file:///photo.jpg");
    expect(uploadAsync).toHaveBeenCalledWith(
      "http://localhost:3000/api/photos/analyze",
      "file:///compressed.jpg",
      expect.objectContaining({
        httpMethod: "POST",
        fieldName: "photo",
        parameters: { intent: "log" },
        headers: { Authorization: "Bearer test-token" },
      }),
    );
    expect(result).toEqual(mockAnalysisResponse);
  });

  it("cleans up compressed image even on upload failure", async () => {
    vi.mocked(tokenStorage.get).mockResolvedValue("test-token");
    vi.mocked(compressImage).mockResolvedValue({
      uri: "file:///compressed.jpg",
      width: 800,
      height: 600,
      sizeKB: 450,
    });
    vi.mocked(uploadAsync).mockRejectedValue(new Error("Network error"));

    await expect(uploadPhotoForAnalysis("file:///photo.jpg")).rejects.toThrow(
      "Network error",
    );
    expect(cleanupImage).toHaveBeenCalledWith("file:///compressed.jpg");
  });

  it("throws with server error message when status is not 200", async () => {
    vi.mocked(tokenStorage.get).mockResolvedValue("test-token");
    vi.mocked(compressImage).mockResolvedValue({
      uri: "file:///compressed.jpg",
      width: 800,
      height: 600,
      sizeKB: 450,
    });
    vi.mocked(uploadAsync).mockResolvedValue({
      status: 500,
      body: JSON.stringify({ error: "Server overloaded" }),
      headers: {},
      mimeType: null,
    });

    await expect(uploadPhotoForAnalysis("file:///photo.jpg")).rejects.toThrow(
      "Upload failed: 500",
    );
    expect(cleanupImage).toHaveBeenCalledWith("file:///compressed.jpg");
  });

  it("throws generic error when error body is not valid JSON", async () => {
    vi.mocked(tokenStorage.get).mockResolvedValue("test-token");
    vi.mocked(compressImage).mockResolvedValue({
      uri: "file:///compressed.jpg",
      width: 800,
      height: 600,
      sizeKB: 450,
    });
    vi.mocked(uploadAsync).mockResolvedValue({
      status: 502,
      body: "Bad Gateway",
      headers: {},
      mimeType: null,
    });

    await expect(uploadPhotoForAnalysis("file:///photo.jpg")).rejects.toThrow(
      "Upload failed: 502",
    );
  });
});

describe("lookupNutritionByPrep", () => {
  const mockNutrition = {
    name: "Steamed broccoli",
    calories: 55,
    protein: 3.7,
    carbs: 11.2,
    fat: 0.6,
    fiber: 5.1,
    sugar: 2.2,
    sodium: 64,
    servingSize: "1 cup",
    source: "usda",
  };

  it("throws if not authenticated", async () => {
    vi.mocked(tokenStorage.get).mockResolvedValue(null);

    await expect(lookupNutritionByPrep("broccoli")).rejects.toThrow(
      "Not authenticated",
    );
  });

  it("returns nutrition data on success", async () => {
    vi.mocked(tokenStorage.get).mockResolvedValue("test-token");
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockNutrition),
    });

    const result = await lookupNutritionByPrep("steamed broccoli 1 cup");

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/nutrition/lookup?name=steamed%20broccoli%201%20cup",
      {
        headers: { Authorization: "Bearer test-token" },
      },
    );
    expect(result).toEqual(mockNutrition);
  });

  it("returns null on 404", async () => {
    vi.mocked(tokenStorage.get).mockResolvedValue("test-token");
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
    });

    const result = await lookupNutritionByPrep("unknownfood xyz");
    expect(result).toBeNull();
  });

  it("throws on non-404 error status", async () => {
    vi.mocked(tokenStorage.get).mockResolvedValue("test-token");
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
    });

    await expect(lookupNutritionByPrep("broccoli")).rejects.toThrow(
      "Nutrition lookup failed: 500",
    );
  });
});

describe("submitFollowUp", () => {
  const mockFollowUpResponse = {
    sessionId: "sess-123",
    intent: "log",
    foods: [{ name: "Grilled chicken", quantity: "6 oz", confidence: 0.95 }],
    overallConfidence: 0.95,
    needsFollowUp: false,
    followUpQuestions: [],
  };

  it("throws if not authenticated", async () => {
    vi.mocked(tokenStorage.get).mockResolvedValue(null);

    await expect(
      submitFollowUp("sess-123", "How was it cooked?", "Grilled"),
    ).rejects.toThrow("Not authenticated");
  });

  it("sends follow-up and returns updated analysis", async () => {
    vi.mocked(tokenStorage.get).mockResolvedValue("test-token");
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockFollowUpResponse),
    });

    const result = await submitFollowUp(
      "sess-123",
      "How was it cooked?",
      "Grilled",
    );

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/photos/analyze/sess-123/followup",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-token",
        },
        body: JSON.stringify({
          question: "How was it cooked?",
          answer: "Grilled",
        }),
      },
    );
    expect(result).toEqual(mockFollowUpResponse);
  });

  it("throws with server error message on failure", async () => {
    vi.mocked(tokenStorage.get).mockResolvedValue("test-token");
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: "Invalid session" }),
    });

    await expect(
      submitFollowUp("bad-sess", "question", "answer"),
    ).rejects.toThrow("Invalid session");
  });

  it("throws generic error when error body parse fails", async () => {
    vi.mocked(tokenStorage.get).mockResolvedValue("test-token");
    mockFetch.mockResolvedValue({
      ok: false,
      status: 503,
      json: () => Promise.reject(new Error("not json")),
    });

    await expect(
      submitFollowUp("sess-123", "question", "answer"),
    ).rejects.toThrow("Follow-up failed: 503");
  });
});

describe("confirmPhotoAnalysis", () => {
  const mockConfirmRequest = {
    sessionId: "sess-123",
    foods: [
      {
        name: "Grilled chicken",
        quantity: "6 oz",
        calories: 280,
        protein: 52,
        carbs: 0,
        fat: 6,
      },
    ],
    mealType: "lunch",
  };

  const mockConfirmResponse = {
    id: 42,
    productName: "Grilled chicken",
  };

  it("throws if not authenticated", async () => {
    vi.mocked(tokenStorage.get).mockResolvedValue(null);

    await expect(confirmPhotoAnalysis(mockConfirmRequest)).rejects.toThrow(
      "Not authenticated",
    );
  });

  it("sends confirm request and returns saved item", async () => {
    vi.mocked(tokenStorage.get).mockResolvedValue("test-token");
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockConfirmResponse),
    });

    const result = await confirmPhotoAnalysis(mockConfirmRequest);

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/photos/confirm",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-token",
        },
        body: JSON.stringify(mockConfirmRequest),
      },
    );
    expect(result).toEqual(mockConfirmResponse);
  });

  it("throws with server error message on failure", async () => {
    vi.mocked(tokenStorage.get).mockResolvedValue("test-token");
    mockFetch.mockResolvedValue({
      ok: false,
      status: 422,
      json: () => Promise.resolve({ error: "Missing required fields" }),
    });

    await expect(confirmPhotoAnalysis(mockConfirmRequest)).rejects.toThrow(
      "Missing required fields",
    );
  });

  it("throws generic error when error body parse fails", async () => {
    vi.mocked(tokenStorage.get).mockResolvedValue("test-token");
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.reject(new Error("not json")),
    });

    await expect(confirmPhotoAnalysis(mockConfirmRequest)).rejects.toThrow(
      "Confirm failed: 500",
    );
  });
});

describe("mapPhotoResultToImportedRecipeData", () => {
  const fullResult: RecipePhotoResult = {
    title: "Pasta Primavera",
    description: "Light veggie pasta",
    ingredients: [
      { name: "penne pasta", quantity: "8", unit: "oz" },
      { name: "zucchini", quantity: "1", unit: "medium" },
    ],
    instructions: "1. Cook pasta\n2. Sauté veggies\n3. Combine",
    servings: 4,
    prepTimeMinutes: 10,
    cookTimeMinutes: 20,
    cuisine: "Italian",
    dietTags: ["vegetarian"],
    caloriesPerServing: 320,
    proteinPerServing: 12,
    carbsPerServing: 48,
    fatPerServing: 8,
    confidence: 0.9,
  };

  it("maps all fields correctly", () => {
    const mapped = mapPhotoResultToImportedRecipeData(fullResult);

    expect(mapped.title).toBe("Pasta Primavera");
    expect(mapped.description).toBe("Light veggie pasta");
    expect(mapped.servings).toBe(4);
    expect(mapped.prepTimeMinutes).toBe(10);
    expect(mapped.cookTimeMinutes).toBe(20);
    expect(mapped.cuisine).toBe("Italian");
    expect(mapped.dietTags).toEqual(["vegetarian"]);
    expect(mapped.ingredients).toHaveLength(2);
    expect(mapped.ingredients[0].name).toBe("penne pasta");
    expect(mapped.instructions).toContain("Cook pasta");
    expect(mapped.imageUrl).toBeNull();
    expect(mapped.sourceUrl).toBe("photo_import");
  });

  it("converts numeric nutrition to strings", () => {
    const mapped = mapPhotoResultToImportedRecipeData(fullResult);

    expect(mapped.caloriesPerServing).toBe("320");
    expect(mapped.proteinPerServing).toBe("12");
    expect(mapped.carbsPerServing).toBe("48");
    expect(mapped.fatPerServing).toBe("8");
  });

  it("handles null nutrition values", () => {
    const noNutrition: RecipePhotoResult = {
      ...fullResult,
      caloriesPerServing: null,
      proteinPerServing: null,
      carbsPerServing: null,
      fatPerServing: null,
    };

    const mapped = mapPhotoResultToImportedRecipeData(noNutrition);

    expect(mapped.caloriesPerServing).toBeNull();
    expect(mapped.proteinPerServing).toBeNull();
    expect(mapped.carbsPerServing).toBeNull();
    expect(mapped.fatPerServing).toBeNull();
  });

  it("always sets sourceUrl to photo_import", () => {
    const mapped = mapPhotoResultToImportedRecipeData(fullResult);
    expect(mapped.sourceUrl).toBe("photo_import");
  });
});
