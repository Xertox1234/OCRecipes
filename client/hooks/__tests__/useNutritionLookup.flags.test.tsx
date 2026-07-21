// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { useNutritionLookup } from "../useNutritionLookup";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";

const { mockGoBack, mockApiRequest } = vi.hoisted(() => ({
  mockGoBack: vi.fn(),
  mockApiRequest: vi.fn(),
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ goBack: mockGoBack }),
}));

vi.mock("@/context/AuthContext", () => ({
  useAuthContext: () => ({ user: { id: 1 } }),
}));

vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({ notification: vi.fn(), impact: vi.fn() }),
}));

vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
  getApiUrl: () => "http://localhost:3000",
}));

vi.mock("@/lib/token-storage", () => ({
  tokenStorage: { get: vi.fn(), set: vi.fn(), clear: vi.fn() },
}));

describe("useNutritionLookup — flags (Task 7)", () => {
  const mockServerFetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mockServerFetch);
    mockApiRequest.mockResolvedValue({
      ok: true,
      json: async () => ({ hasFrontLabelData: false }),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps flags from the server barcode response", async () => {
    mockServerFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        productName: "Peanut Butter Cups",
        brandName: "Acme",
        barcode: "000000000001",
        per100g: { calories: 500, protein: 10, carbs: 40, fat: 30 },
        perServing: { calories: 200, protein: 4, carbs: 16, fat: 12 },
        servingInfo: { displayLabel: "40g", grams: 40, wasCorrected: false },
        isServingDataTrusted: true,
        source: "openfoodfacts",
        flags: [
          {
            id: "allergen:peanuts",
            kind: "allergen",
            severity: "danger",
            tier: "safety",
            title: "Contains Peanuts",
          },
        ],
      }),
    });

    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(
      () => useNutritionLookup({ barcode: "000000000001" }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.flags).toHaveLength(1);
    expect(result.current.flags[0].title).toBe("Contains Peanuts");
  });

  it("leaves flags empty when the server response omits flags", async () => {
    mockServerFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        productName: "Mystery Snack",
        brandName: "GenericBrand",
        barcode: "000000000002",
        per100g: { calories: 400, protein: 5, carbs: 60, fat: 10 },
        perServing: { calories: 400, protein: 5, carbs: 60, fat: 10 },
        servingInfo: { displayLabel: "100g", grams: 100, wasCorrected: false },
        isServingDataTrusted: false,
        source: "openfoodfacts",
      }),
    });

    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(
      () => useNutritionLookup({ barcode: "000000000002" }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.flags).toEqual([]);
  });

  it("leaves flags empty on the direct-OFF fallback path (server unreachable)", async () => {
    // First call (server lookup) throws — hook falls through to the direct
    // Open Food Facts fetch. Second call is the OFF response.
    mockServerFetch
      .mockRejectedValueOnce(new Error("server unreachable"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 1,
          product: {
            product_name: "Fallback Snack",
            brands: "GenericBrand",
            nutriments: {
              "energy-kcal_100g": 400,
              proteins_100g: 5,
              carbohydrates_100g: 60,
              fat_100g: 10,
            },
          },
        }),
      });

    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(
      () => useNutritionLookup({ barcode: "000000000003" }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Phase 1 does not compute client-side allergen flags — the fallback
    // path must never populate flags, even if the product would otherwise
    // match an allergen.
    expect(result.current.flags).toEqual([]);
  });
});
