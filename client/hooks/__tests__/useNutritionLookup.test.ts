// @vitest-environment jsdom
import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { useNutritionLookup } from "../useNutritionLookup";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";
import { getServingContextLabel } from "@/screens/nutrition-detail-utils";
import { ApiError } from "@/lib/api-error";
import { ErrorCode } from "@shared/constants/error-codes";

const {
  mockGoBack,
  mockReset,
  mockPopTo,
  mockToastError,
  mockToastSuccess,
  mockApiRequest,
  mockNotification,
} = vi.hoisted(() => ({
  mockGoBack: vi.fn(),
  mockReset: vi.fn(),
  mockPopTo: vi.fn(),
  mockToastError: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockApiRequest: vi.fn(),
  mockNotification: vi.fn(),
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    goBack: mockGoBack,
    reset: mockReset,
    popTo: mockPopTo,
  }),
}));

vi.mock("@/context/AuthContext", () => ({
  useAuthContext: () => ({ user: { id: 1 } }),
}));

vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({ notification: mockNotification, impact: vi.fn() }),
}));

vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({
    success: mockToastSuccess,
    error: mockToastError,
    info: vi.fn(),
  }),
}));

vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
  getApiUrl: () => "http://localhost:3000",
}));

vi.mock("@/lib/token-storage", () => ({
  tokenStorage: { get: vi.fn(), set: vi.fn(), clear: vi.fn() },
}));

describe("useNutritionLookup — addToLogMutation error surfacing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("surfaces an error toast when POST /api/scanned-items fails", async () => {
    mockApiRequest.mockRejectedValueOnce(new Error("network down"));
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(
      () => useNutritionLookup({ imageUri: "photo.jpg" }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      result.current.handleAddToLog();
    });

    await waitFor(() => expect(mockToastError).toHaveBeenCalledTimes(1));
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  it("shows a rate-limit-specific message when the server throttles the request", async () => {
    mockApiRequest.mockRejectedValueOnce(
      new ApiError("429: Too Many Requests", ErrorCode.RATE_LIMITED),
    );
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(
      () => useNutritionLookup({ imageUri: "photo.jpg" }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      result.current.handleAddToLog();
    });

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith(
        "Too many requests. Please wait a moment and try again.",
      ),
    );
  });

  it("does not show an error toast and resets to Today on success", async () => {
    mockApiRequest.mockResolvedValueOnce({
      json: async () => ({ id: 1 }),
    });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(
      () => useNutritionLookup({ imageUri: "photo.jpg" }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      result.current.handleAddToLog();
    });

    // NutritionDetail is pushed from inside the scan fullScreenModal, so
    // goBack() would pop to the live camera — see Task 7 (D5 fix). It must be a
    // POP, not a reset: reaching Main means dismissing two stacked native modal
    // presentations, and `reset` silently no-ops there on iOS (device-verified
    // 2026-07-30). See the sibling test in useNutritionLookup.labelRead.test.tsx
    // for the full rationale.
    await waitFor(() =>
      expect(mockPopTo).toHaveBeenCalledWith("Main", { screen: "HomeTab" }),
    );
    // Cardinality alongside the argument check — `toHaveBeenCalledWith` alone
    // passes for a double pop, which would flash Today twice and re-run the
    // navigator's mount effects.
    expect(mockPopTo).toHaveBeenCalledTimes(1);
    expect(mockReset).not.toHaveBeenCalled();
    expect(mockGoBack).not.toHaveBeenCalled();
    expect(mockToastError).not.toHaveBeenCalled();
  });
});

describe("useNutritionLookup — isPer100g regression (P2-2026-07-14)", () => {
  const mockServerFetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mockServerFetch);
    // Non-critical follow-up call inside fetchBarcodeData — resolve it so it
    // doesn't throw noise; the hook already treats its failure as harmless.
    mockApiRequest.mockResolvedValue({
      ok: true,
      json: async () => ({ hasFrontLabelData: false }),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not mark a real, scaled serving size as per-100g (Cherry Coke case)", async () => {
    // Server response shaped like the fixed barcode-lookup service: a real
    // serving size (355ml) was parsed and used to scale the values, and
    // isServingDataTrusted correctly reflects that — independent of whether
    // a secondary source (CNF/USDA) cross-validated the calorie count.
    mockServerFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        productName: "Cherry Coke",
        brandName: "Coca-Cola",
        barcode: "049000028911",
        per100g: { calories: 23, protein: 0, carbs: 5.8, fat: 0 },
        perServing: { calories: 82, protein: 0, carbs: 20.6, fat: 0 },
        servingInfo: {
          displayLabel: "355 ml",
          grams: 355,
          wasCorrected: false,
        },
        isServingDataTrusted: true,
        source: "openfoodfacts",
      }),
    });

    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(
      () => useNutritionLookup({ barcode: "049000028911" }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Formula under regression guard: !isServingDataTrusted && !wasCorrected
    // = !true && !false = false — must NOT show "(per 100g)".
    expect(result.current.isPer100g).toBe(false);
  });

  it("marks a product with no serving-size data at all as per-100g", async () => {
    // No real serving data existed to scale — the legitimate case where the
    // per-100g/"Check package" treatment must be preserved.
    mockServerFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        productName: "Mystery Snack",
        brandName: "GenericBrand",
        barcode: "012345678905",
        per100g: { calories: 400, protein: 5, carbs: 60, fat: 10 },
        perServing: { calories: 400, protein: 5, carbs: 60, fat: 10 },
        servingInfo: {
          displayLabel: "100g",
          grams: 100,
          wasCorrected: false,
        },
        isServingDataTrusted: false,
        source: "openfoodfacts",
      }),
    });

    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(
      () => useNutritionLookup({ barcode: "012345678905" }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Formula under regression guard: !isServingDataTrusted && !wasCorrected
    // = !false && !false = true — the per-100g/Check-package treatment shows.
    expect(result.current.isPer100g).toBe(true);
  });

  it("does not mark a corrected (estimated) serving as per-100g", async () => {
    // Discriminates the full two-term formula from a `!isServingDataTrusted`-
    // only simplification: isServingDataTrusted is false (correctly — the
    // serving was estimated, not real), but wasCorrected is true, so the
    // full formula (`!isServingDataTrusted && !wasCorrected`) still evaluates
    // to false. A simplified `!isServingDataTrusted` alone would wrongly
    // evaluate to true here and mislabel an already-scaled estimate as
    // per-100g — this test fails under that regression.
    mockServerFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        productName: "Hot Chocolate K-Cup Pods",
        brandName: undefined,
        barcode: "0663447217174",
        per100g: { calories: 400, protein: 5, carbs: 80, fat: 5 },
        perServing: { calories: 60, protein: 0.8, carbs: 12, fat: 0.8 },
        servingInfo: {
          displayLabel: "~15g (estimated)",
          grams: 15,
          wasCorrected: true,
          correctionReason:
            "Original serving (236g) appears to be the full package — adjusted to ~15g.",
        },
        isServingDataTrusted: false,
        source: "openfoodfacts",
      }),
    });

    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(
      () => useNutritionLookup({ barcode: "0663447217174" }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Formula under regression guard: !isServingDataTrusted && !wasCorrected
    // = !false && !true = false — must NOT show "(per 100g)".
    expect(result.current.isPer100g).toBe(false);
  });
});

describe("useNutritionLookup — trust-the-label override (Task 5)", () => {
  const mockServerFetch = vi.fn();

  // Minimal-but-complete buildBarcodeResponseBody-shaped body — the hook
  // reads perServing/servingInfo/etc. off the OK response before it ever
  // looks at `conflict`, so a partial body would throw before assertions run.
  function baseBody(overrides: Record<string, unknown> = {}) {
    return {
      productName: "Cherry Coke",
      brandName: "Coca-Cola",
      barcode: "06772408",
      perServing: {
        calories: 39,
        protein: 0,
        carbs: 10,
        fat: 0,
        fiber: 0,
        sugar: 10,
        sodium: 5,
        saturatedFat: 0,
        transFat: 0,
        cholesterol: 0,
        caffeine: 10,
      },
      per100g: { calories: 11, protein: 0, carbs: 2.8, fat: 0 },
      servingInfo: { displayLabel: "355 ml", grams: 355, wasCorrected: false },
      isServingDataTrusted: true,
      imageUrl: undefined,
      novaGroup: 4,
      nutriScore: "e",
      flags: [{ id: "processing:ultra" }],
      verificationLevel: "unverified",
      ...overrides,
    };
  }

  function mockBarcodeFetch(overrides: Record<string, unknown> = {}) {
    mockServerFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => baseBody(overrides),
    });
    return mockServerFetch;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mockServerFetch);
    // Non-critical follow-up call inside fetchBarcodeData — resolve it so it
    // doesn't derail the barcode-path assertions under test.
    mockApiRequest.mockResolvedValue({
      ok: true,
      json: async () => ({ hasFrontLabelData: false }),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to the barcode endpoint with labelNutrition when the label is readable", async () => {
    const fetchSpy = mockBarcodeFetch();
    const { wrapper } = createQueryWrapper();
    renderHook(
      () =>
        useNutritionLookup({
          barcode: "06772408",
          ocrText: "Per 355 mL\nCalories 150\nSugars / Sucres 39 g",
        }),
      { wrapper },
    );

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const call = fetchSpy.mock.calls.at(-1)!;
    expect(call[1]?.method).toBe("POST");
    const body = JSON.parse(call[1]!.body as string);
    expect(body.labelNutrition.totalSugars).toBe(39);
    // All five keys must be present (server schema is .nullable() but not
    // .optional() — an omitted key 400s the whole request).
    expect(Object.keys(body.labelNutrition).sort()).toEqual(
      [
        "calories",
        "saturatedFat",
        "servingSize",
        "totalFat",
        "totalSugars",
      ].sort(),
    );
  });

  it("GETs (no POST) when ocrText is absent or unreadable", async () => {
    const fetchSpy = mockBarcodeFetch();
    const { wrapper } = createQueryWrapper();
    renderHook(
      () =>
        useNutritionLookup({ barcode: "06772408", ocrText: "blurry nothing" }),
      { wrapper },
    );

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(fetchSpy.mock.calls.at(-1)![1]?.method ?? "GET").toBe("GET");
  });

  it("GETs (no POST) when ocrText param is not provided at all", async () => {
    const fetchSpy = mockBarcodeFetch();
    const { wrapper } = createQueryWrapper();
    renderHook(() => useNutritionLookup({ barcode: "06772408" }), { wrapper });

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(fetchSpy.mock.calls.at(-1)![1]?.method ?? "GET").toBe("GET");
  });

  it("exposes conflict and toggles nutrition+flags between DB and label", async () => {
    mockBarcodeFetch({
      conflict: {
        fields: ["sugar"],
        label: baseBody({
          perServing: {
            calories: 150,
            protein: 0,
            carbs: 39,
            fat: 0,
            fiber: 0,
            sugar: 39,
            sodium: 5,
            saturatedFat: 0,
            transFat: 0,
            cholesterol: 0,
            caffeine: 10,
          },
          flags: [{ id: "processing:ultra" }, { id: "nutrient:sugar" }],
        }),
      },
    });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(
      () =>
        useNutritionLookup({
          barcode: "06772408",
          ocrText: "Per 355 mL\nCalories 150\nSugars / Sucres 39 g",
        }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.conflict).not.toBeNull());
    // Health-facing default: trust the label.
    expect(result.current.activeSource).toBe("label");
    expect(result.current.nutrition?.calories).toBe(150);
    expect(result.current.flags.map((f) => f.id)).toContain("nutrient:sugar");
    expect(result.current.dbNutrition?.calories).toBe(39);

    act(() => result.current.chooseSource("database"));
    expect(result.current.nutrition?.calories).toBe(39);
    expect(result.current.activeSource).toBe("database");

    act(() => result.current.chooseSource("label"));
    expect(result.current.nutrition?.calories).toBe(150);
    expect(result.current.activeSource).toBe("label");
  });

  it("swaps serving-control state so a serving edit rescales from the ACTIVE source's per-100g", async () => {
    mockBarcodeFetch({
      // DB per-100g calories = 11 (baseBody default = the wrong Cherry Coke entry)
      conflict: {
        fields: ["calories", "sugar"],
        label: baseBody({
          perServing: {
            calories: 150,
            protein: 0,
            carbs: 39,
            fat: 0,
            fiber: 0,
            sugar: 39,
            sodium: 5,
            saturatedFat: 0,
            transFat: 0,
            cholesterol: 0,
            caffeine: 10,
          },
          // Label per-100g is DISTINCT from the DB's (42 vs 11) so a rescale
          // reveals which source's per-100g the serving controls are using.
          per100g: { calories: 42, protein: 0, carbs: 11, fat: 0 },
          flags: [{ id: "processing:ultra" }, { id: "nutrient:sugar" }],
        }),
      },
    });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(
      () =>
        useNutritionLookup({
          barcode: "06772408",
          ocrText: "Per 355 mL\nCalories 150\nSugars / Sucres 39 g",
        }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.conflict).not.toBeNull());
    // Default is the label → serving controls must scale from the LABEL per-100g.
    expect(result.current.activeSource).toBe("label");
    expect(result.current.validatedData?.per100g.calories).toBe(42);
    act(() => result.current.recalculateNutrition(100, 1));
    expect(result.current.nutrition?.calories).toBe(42); // label per-100g, NOT the DB's 11

    // Toggling to the DB moves the serving-control source with it.
    act(() => result.current.chooseSource("database"));
    expect(result.current.validatedData?.per100g.calories).toBe(11);
    act(() => result.current.recalculateNutrition(100, 1));
    expect(result.current.nutrition?.calories).toBe(11);
  });

  it("does not surface a conflict when the server returns none", async () => {
    mockBarcodeFetch();
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(
      () =>
        useNutritionLookup({
          barcode: "06772408",
          ocrText: "Per 355 mL\nCalories 150\nSugars / Sucres 39 g",
        }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.conflict).toBeNull();
    expect(result.current.activeSource).toBe("database");
  });
});

describe("useNutritionLookup — unknown serving weight (direct-OFF fallback)", () => {
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

  /**
   * Drives the hook down the direct-Open-Food-Facts fallback: the server leg
   * rejects (unreachable), so `fetchBarcodeData` falls through to the public OFF
   * endpoint and normalizes the product client-side via
   * `validateAndNormalizeNutrition`.
   */
  function mockOffFallback(product: Record<string, unknown>) {
    mockServerFetch
      .mockRejectedValueOnce(new Error("server unreachable"))
      .mockResolvedValueOnce({
        json: async () => ({ status: 1, product }),
      });
  }

  /**
   * A real Open Food Facts shape: per-serving energy is published, but
   * `serving_size` is a household count with no metric quantity anywhere and
   * there is no `serving_quantity`. `parseServingGrams` returns null, yet the
   * per-serving values are perfectly trustworthy — so
   * `validateAndNormalizeNutrition` takes its trusted branch and emits
   * `{ grams: null, isServingDataTrusted: true }`.
   */
  const UNPARSEABLE_SERVING_PRODUCT = {
    product_name: "Kombucha, Ginger Lemon",
    brands: "GT's",
    serving_size: "1 bottle",
    nutriments: {
      "energy-kcal_100g": 21,
      proteins_100g: 0,
      carbohydrates_100g: 5,
      fat_100g: 0,
      sugars_100g: 4,
      "energy-kcal_serving": 100,
      proteins_serving: 0,
      carbohydrates_serving: 24,
      fat_serving: 0,
      sugars_serving: 19,
    },
  };

  it("leaves the serving weight unknown instead of fabricating 100 g", async () => {
    mockOffFallback(UNPARSEABLE_SERVING_PRODUCT);

    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(
      () => useNutritionLookup({ barcode: "0722430900001" }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // The values on screen are the bottle's, and they are correct.
    expect(result.current.nutrition?.calories).toBe(100);
    // They are NOT per-100g values, so the "Values shown per 100g" banner must
    // stay hidden — this is a real serving, just one of unknown weight.
    expect(result.current.isPer100g).toBe(false);

    // The bug: `grams ?? 100` asserted a 100 g basis the product never gave us,
    // which captioned a per-bottle value "1 × 100g" and lit the 100 g chip as
    // the active selection. Unknown must stay unknown.
    expect(result.current.servingSizeGrams).toBeNull();
    expect(
      getServingContextLabel({
        servingQuantity: result.current.servingQuantity,
        servingSizeGrams: result.current.servingSizeGrams,
        servingOptions: result.current.servingOptions,
        isPer100g: result.current.isPer100g,
      }),
    ).toBe("serving");
  });

  it("still scales by quantity when the serving weight is unknown", async () => {
    mockOffFallback(UNPARSEABLE_SERVING_PRODUCT);

    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(
      () => useNutritionLookup({ barcode: "0722430900001" }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // `servings` is never applied server-side (server/routes/nutrition.ts stores
    // the posted nutrient values verbatim), so the stepper MUST rescale here or
    // the user logs one bottle while the counter reads two.
    act(() => result.current.recalculateNutrition(null, 2));

    expect(result.current.nutrition?.calories).toBe(200);
    expect(result.current.nutrition?.sugar).toBe(38);
    // And the caption must keep the product's own wording — not "nullg"/"100g".
    expect(result.current.nutrition?.servingSize).toBe("1 bottle");
  });

  it("regression: a parseable serving weight is unchanged", async () => {
    mockOffFallback({
      product_name: "Sparkling Water, Lime",
      brands: "Bubly",
      serving_size: "355 ml",
      nutriments: {
        "energy-kcal_100g": 20,
        carbohydrates_100g: 5,
        "energy-kcal_serving": 71,
        carbohydrates_serving: 17.8,
      },
    });

    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(
      () => useNutritionLookup({ barcode: "0012000171705" }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.servingSizeGrams).toBe(355);
    expect(result.current.isPer100g).toBe(false);
    expect(result.current.nutrition?.calories).toBe(71);

    // Known-grams scaling still runs off per-100g, exactly as before.
    act(() => result.current.recalculateNutrition(355, 2));
    expect(result.current.nutrition?.calories).toBeCloseTo(142, 5);
    expect(result.current.nutrition?.servingSize).toBe("355g");
  });
});
