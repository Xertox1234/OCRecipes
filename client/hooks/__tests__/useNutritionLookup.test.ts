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

  // P1-2026-09-23: addToLogMutation used to invalidate only scannedItems and
  // dailySummary on a real online success, leaving Home's calorie header
  // (useDailyBudget) stale.
  it("invalidates /api/daily-budget on a successful online log", async () => {
    mockApiRequest.mockResolvedValueOnce({
      json: async () => ({ id: 1 }),
    });
    const { wrapper, queryClient } = createQueryWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(
      () => useNutritionLookup({ imageUri: "photo.jpg" }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      result.current.handleAddToLog();
    });

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["/api/daily-budget"],
      }),
    );
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
    // All five VALUE keys must be present (the server schema is `.nullable()`
    // but not `.optional()` for those — an omitted key 400s the whole request),
    // plus `directReads`, the OCR provenance the server needs to decide whether
    // it may compare `saturatedFat` against the database record.
    expect(Object.keys(body.labelNutrition).sort()).toEqual(
      [
        "calories",
        "directReads",
        "saturatedFat",
        "servingSize",
        "totalFat",
        "totalSugars",
      ].sort(),
    );
    // And it carries the real parse, not an empty placeholder: this panel reads
    // calories and sugars off actual glyphs. `saturatedFat` has no line here at
    // all, so it is absent from the list as well as null — nothing about a
    // missing field may look like a direct read.
    expect(body.labelNutrition.directReads.sort()).toEqual(
      ["calories", "totalSugars"].sort(),
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

  /**
   * A zero serving weight is not a weight — it is the same absence of data as a
   * null, and `parseServingGrams` hands it back as a number.
   * `server/services/barcode-lookup.ts` documents its own `|| 100` as a guard
   * for "a pathological '0 ml' parse", so this shape occurs in live OFF data;
   * the client's trusted branch has no equivalent guard and emits
   * `{ grams: 0, isServingDataTrusted: true }`.
   */
  const ZERO_SERVING_PRODUCT = {
    product_name: "Sparkling Beverage",
    brands: "Generic",
    serving_size: "0 ml",
    nutriments: {
      "energy-kcal_100g": 21,
      carbohydrates_100g: 5,
      sugars_100g: 4,
      "energy-kcal_serving": 100,
      carbohydrates_serving: 24,
      sugars_serving: 19,
    },
  };

  it("treats a zero serving weight as unknown, not as a real basis", async () => {
    mockOffFallback(ZERO_SERVING_PRODUCT);

    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(
      () => useNutritionLookup({ barcode: "0000000000001" }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.servingSizeGrams).toBeNull();
    // Not "1 × 0 g" — a zero basis that reaches the caption reads as a real
    // measurement of nothing.
    expect(
      getServingContextLabel({
        servingQuantity: result.current.servingQuantity,
        servingSizeGrams: result.current.servingSizeGrams,
        servingOptions: result.current.servingOptions,
        isPer100g: result.current.isPer100g,
      }),
    ).toBe("serving");
  });

  it("does not zero the card when the stepper runs at a zero serving weight", async () => {
    mockOffFallback(ZERO_SERVING_PRODUCT);

    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(
      () => useNutritionLookup({ barcode: "0000000000001" }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.nutrition?.calories).toBe(100);

    // `factor = (0 / 100) * quantity` is zero, so a zero basis reaching the
    // per-100g path blanks every macro and writes a 0-calorie log entry.
    act(() => result.current.recalculateNutrition(0, 2));

    expect(result.current.nutrition?.calories).toBe(200);
    expect(result.current.nutrition?.sugar).toBe(38);
    // The product's own wording, preserved. Pre-fix the per-100g branch
    // overwrote this with `${grams}g` — i.e. the literal "0g".
    expect(result.current.nutrition?.servingSize).toBe("0 ml");
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

/**
 * `effectivePer100g`'s guard from #819, one layer up from
 * `recalculateNutrition`'s own `> 0` check.
 *
 * Removing the saved-item branch (2026-09-17) removed the last STEADY producer
 * of the guard's other arm — `validatedData === null` while
 * `nutrition.calories` is defined. Every `setNutrition` that settles with
 * calories now pairs with a `setValidatedData` on the same path (server-DB,
 * label-override, OFF fallback, conflict/snapshot, manual-search), and the ones
 * that do not — "Product Not Found", "Unknown Product", "Manual Entry" — carry
 * no calories.
 *
 * The state is still reached IN TRANSIT, and the second test below pins it
 * there: `fetchBarcodeData`'s per-lookup reset nulls `validatedData` without
 * resetting `nutrition` or `servingSizeGrams`, so a re-fetch on a mounted
 * instance holds the prior product's values with no validated basis for the
 * duration of the new lookup. The two tests removed with the saved-item branch
 * asserted this arm through the steady state; the one below asserts it through
 * the window that survives.
 */
describe("useNutritionLookup — per-100g basis guard placement", () => {
  const mockServerFetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mockServerFetch);
    mockApiRequest.mockResolvedValue({
      ok: true,
      json: async () => ({
        hasFrontLabelData: false,
        foodName: "Kombucha, Ginger Lemon",
        micronutrients: [],
      }),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("regression: a validated per-100g basis still wins when the weight is unknown", async () => {
    // The direct-OFF fallback publishes trustworthy per-serving values against
    // a serving of unknown weight, so it reaches `effectivePer100g` with
    // `servingSizeGrams === null` AND a real `validatedData.per100g`. The new
    // positive-grams guard must sit BELOW the validatedData branch: one line
    // higher and it nulls this out, killing the serving controls on a path
    // that works today.
    //
    // This test is green both before and after the fix — it is a placement
    // pin, not a bug reproduction — so its value rests on mutation evidence
    // rather than a natural RED. Executed 2026-08-15: hoisting the guard above
    // `if (validatedData) return validatedData.per100g;` turns THIS test red
    // (calories stay at the pre-recalc 100 instead of reaching 21). That run
    // also had two saved-item companions covering the guard's OTHER arm; they
    // were removed with the saved-item branch on 2026-09-17 (see this
    // describe's docblock — that arm no longer has a reachable input). The
    // mutation has NOT been re-run since; re-run it before weakening this test,
    // which is now the only coverage of the guard's placement.
    mockServerFetch
      .mockRejectedValueOnce(new Error("server unreachable"))
      .mockResolvedValueOnce({
        json: async () => ({
          status: 1,
          product: {
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
          },
        }),
      });

    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(
      () => useNutritionLookup({ barcode: "0722430900001" }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.servingSizeGrams).toBeNull();
    expect(result.current.validatedData).not.toBeNull();

    // Factor is exactly 1, so the card must land on `validatedData.per100g`
    // byte-identically.
    act(() => result.current.recalculateNutrition(100, 1));

    expect(result.current.nutrition?.calories).toBe(21);
    expect(result.current.nutrition?.carbs).toBe(5);
    expect(result.current.nutrition?.sugar).toBe(4);
  });

  it("returns no basis mid-re-fetch, when the reset has nulled validatedData but the prior values remain", async () => {
    // The reset at the top of `fetchBarcodeData` nulls `validatedData` and
    // resets NEITHER `nutrition` NOR `servingSizeGrams`. So between a new
    // barcode arriving and its lookup landing, the hook holds the PRIOR
    // product's per-serving values with no validated basis behind them — the
    // exact pair this guard exists for, and the reason it is not merely
    // defensive after the saved-item branch was removed.
    //
    // The first product is an OFF record whose serving is "1 bottle", so
    // `servingSizeGrams` stays null and the BACK-CALCULATION arm is what has to
    // fire here — not the `if (validatedData)` branch above it, which the
    // preceding test pins.
    mockServerFetch
      .mockRejectedValueOnce(new Error("server unreachable"))
      .mockResolvedValueOnce({
        json: async () => ({
          status: 1,
          product: {
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
          },
        }),
      });

    const { wrapper } = createQueryWrapper();
    const { result, rerender } = renderHook(
      ({ barcode }: { barcode: string }) => useNutritionLookup({ barcode }),
      { wrapper, initialProps: { barcode: "0722430900001" } },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.validatedData).not.toBeNull();
    expect(result.current.servingSizeGrams).toBeNull();
    expect(result.current.nutrition?.calories).toBe(100);

    // Hold the second lookup in flight: the reset has run, nothing has landed.
    mockServerFetch.mockReturnValue(new Promise(() => {}));
    rerender({ barcode: "0000000000009" });

    await waitFor(() => expect(result.current.validatedData).toBeNull());
    expect(result.current.nutrition?.calories).toBe(100);
    expect(result.current.servingSizeGrams).toBeNull();

    const before = result.current.nutrition;
    act(() => result.current.recalculateNutrition(236, 1));

    // `|| 100` made the factor exactly 1, which would relabel the PRIOR
    // product's per-serving values as per-100g on the card.
    expect(result.current.nutrition).toEqual(before);
    expect(result.current.nutrition?.calories).toBe(100);
  });
});

describe("useNutritionLookup — isBeverage (Task 8)", () => {
  const mockServerFetch = vi.fn();

  // Minimal-but-complete buildBarcodeResponseBody-shaped body — the hook
  // reads perServing/servingInfo/etc. off the OK response before it ever
  // looks at isBeverage, so a partial body would throw before assertions run.
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
      flags: [],
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
    // Non-critical follow-up calls inside fetchBarcodeData (front-label
    // verification) and the micronutrients query — resolve
    // them so they don't derail the isBeverage assertions under test.
    mockApiRequest.mockResolvedValue({
      ok: true,
      json: async () => ({
        hasFrontLabelData: false,
        foodName: "Leftover chili",
        micronutrients: [],
      }),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("exposes isBeverage from a successful barcode response", async () => {
    mockBarcodeFetch({ isBeverage: true });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(
      () => useNutritionLookup({ barcode: "06772408" }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isBeverage).toBe(true);
  });

  it("exposes false from a successful barcode response with a categorized non-beverage", async () => {
    // `false` is a real signal, not the absence of one — Task 4 emits it
    // whenever the server DOES have category data and the product isn't a
    // drink, which is the majority path for categorized food. `toBe`, not
    // `toBeFalsy`: the latter also passes on null and would hide a
    // false→null collapse regression.
    mockBarcodeFetch({ isBeverage: false });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(
      () => useNutritionLookup({ barcode: "06772408" }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isBeverage).toBe(false);
  });

  it("exposes null when isBeverage is absent from the response (USDA-only shape)", async () => {
    // The normal path for uncategorized products now that the server omits
    // the key rather than sending false. Null means "no signal", which
    // resolveBasis treats as unknown rather than defaulting to food.
    mockBarcodeFetch();
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(
      () => useNutritionLookup({ barcode: "06772408" }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isBeverage).toBeNull();
  });

  it("exposes null when isBeverage is present but not a boolean", async () => {
    // The response is consumed as untyped json(); a wire field must be
    // narrowed at the boundary, not trusted.
    mockBarcodeFetch({ isBeverage: "true" });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(
      () => useNutritionLookup({ barcode: "06772408" }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isBeverage).toBeNull();
  });

  it("exposes null on the image-entry path, which never runs the barcode handler", async () => {
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(
      () => useNutritionLookup({ imageUri: "file:///manual.jpg" }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    // The imageUri branch never calls fetchBarcodeData, so isBeverage keeps
    // its null initialiser. This assertion moved off the saved-item path when
    // that branch was removed (2026-09-17); imageUri is the surviving entry
    // mode that reaches the hook without a barcode lookup.
    expect(result.current.isBeverage).toBeNull();
    expect(mockServerFetch).not.toHaveBeenCalled();
  });

  it("resets isBeverage to null on a re-fetch (same hook instance) that takes a non-success path", async () => {
    // `isBeverage` is written ONLY in the `serverRes.ok` branch, so it needs
    // its own entry in the per-lookup reset block alongside `flags`,
    // `conflict`, `labelUsed`, etc. — otherwise a re-fetch on the same hook
    // instance (e.g. a mounted screen handed a new barcode) leaks the PRIOR
    // product's classification into every non-success exit.
    mockBarcodeFetch({ isBeverage: true });
    const { wrapper } = createQueryWrapper();
    const { result, rerender } = renderHook(
      ({ barcode }: { barcode: string }) => useNutritionLookup({ barcode }),
      { wrapper, initialProps: { barcode: "06772408" } },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isBeverage).toBe(true);

    // Second barcode: the primary server fetch fails outright, and the
    // direct-OFF fallback ALSO fails — landing on the total-outage catch,
    // which never touches `isBeverage`. Without the reset, the hook would
    // still be reporting the FIRST product's `true` here.
    mockServerFetch.mockRejectedValueOnce(new Error("network down"));
    mockServerFetch.mockRejectedValueOnce(new Error("off unreachable"));

    rerender({ barcode: "00000000" });

    await waitFor(() =>
      expect(result.current.nutrition?.barcode).toBe("00000000"),
    );
    expect(result.current.isBeverage).toBeNull();
  });
});

describe("useNutritionLookup — correctionNotice/isPer100g reset per lookup (P2-2026-09-23)", () => {
  // Out-of-contract file (not in this todo's Scope Contract): needed for AC #4.
  // `NutritionDetailScreen.test.tsx` mocks the hook's return value directly
  // (`renderScan`), so no edit there can ever exercise `fetchBarcodeData`'s
  // reset block or go red on this bug — only a real hook render can.
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

  it("resets correctionNotice to null on a re-fetch (same hook instance) that takes a non-success path", async () => {
    // `correctionNotice` is written ONLY on a successful lookup whose
    // `servingInfo.wasCorrected` is true, so it needs its own entry in the
    // per-lookup reset block alongside `flags`, `conflict`, `isBeverage`,
    // etc. — otherwise a re-fetch on the same hook instance (e.g. a mounted
    // screen handed a new barcode after a label retake) leaks the PRIOR
    // product's correction notice into every non-success exit, including one
    // that also sets `error` — the two-announce collision this todo closes.
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
    const { result, rerender } = renderHook(
      ({ barcode }: { barcode: string }) => useNutritionLookup({ barcode }),
      { wrapper, initialProps: { barcode: "0663447217174" } },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.correctionNotice).toMatch(/adjusted/i);

    // Second barcode: the primary server fetch fails outright, and the
    // direct-OFF fallback ALSO fails — landing on the total-outage catch,
    // which never touches `correctionNotice`. Without the reset, the hook
    // would still be reporting the FIRST product's stale notice here.
    mockServerFetch.mockRejectedValueOnce(new Error("network down"));
    mockServerFetch.mockRejectedValueOnce(new Error("off unreachable"));

    rerender({ barcode: "00000000" });

    await waitFor(() =>
      expect(result.current.nutrition?.barcode).toBe("00000000"),
    );
    expect(result.current.correctionNotice).toBeNull();
  });

  it("resets isPer100g to false on a re-fetch (same hook instance) that takes a non-success path", async () => {
    // `isPer100g` is written ONLY on a successful lookup (formula:
    // `!isServingDataTrusted && !wasCorrected`), so — like `isBeverage` above
    // — it needs its own entry in the per-lookup reset block. Without it, a
    // re-fetch that takes a non-success path inherits the PRIOR product's
    // `true`, mislabeling the "Values shown per 100g" banner state.
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
    const { result, rerender } = renderHook(
      ({ barcode }: { barcode: string }) => useNutritionLookup({ barcode }),
      { wrapper, initialProps: { barcode: "012345678905" } },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isPer100g).toBe(true);

    mockServerFetch.mockRejectedValueOnce(new Error("network down"));
    mockServerFetch.mockRejectedValueOnce(new Error("off unreachable"));

    rerender({ barcode: "00000000" });

    await waitFor(() =>
      expect(result.current.nutrition?.barcode).toBe("00000000"),
    );
    expect(result.current.isPer100g).toBe(false);
  });

  // The inverse direction: states set only on a FAILURE (or conditional)
  // exit must not survive into a later lookup that takes a different exit.
  const SUCCESS_BODY = {
    productName: "Mystery Snack",
    brandName: "GenericBrand",
    per100g: { calories: 400, protein: 5, carbs: 60, fat: 10 },
    perServing: { calories: 400, protein: 5, carbs: 60, fat: 10 },
    servingInfo: { displayLabel: "100g", grams: 100, wasCorrected: false },
    isServingDataTrusted: true,
    source: "openfoodfacts",
  };

  function renderLookup(barcode: string) {
    const { wrapper } = createQueryWrapper();
    return renderHook(
      ({ barcode: code }: { barcode: string }) =>
        useNutritionLookup({ barcode: code }),
      { wrapper, initialProps: { barcode } },
    );
  }

  it("clears a prior lookup's error when the next lookup succeeds", async () => {
    mockServerFetch.mockRejectedValueOnce(new Error("network down"));
    mockServerFetch.mockRejectedValueOnce(new Error("off unreachable"));
    const { result, rerender } = renderLookup("00000000");
    await waitFor(() => expect(result.current.error).not.toBeNull());

    mockServerFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ...SUCCESS_BODY, barcode: "012345678905" }),
    });
    rerender({ barcode: "012345678905" });

    await waitFor(() =>
      expect(result.current.nutrition?.productName).toBe("Mystery Snack"),
    );
    expect(result.current.error).toBeNull();
  });

  it("hides a prior lookup's manual-search card when the next barcode resolves", async () => {
    mockServerFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ notInDatabase: true }),
    });
    const { result, rerender } = renderLookup("11111111");
    await waitFor(() => expect(result.current.showManualSearch).toBe(true));

    mockServerFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ...SUCCESS_BODY, barcode: "012345678905" }),
    });
    rerender({ barcode: "012345678905" });

    await waitFor(() =>
      expect(result.current.nutrition?.productName).toBe("Mystery Snack"),
    );
    expect(result.current.showManualSearch).toBe(false);
  });

  it("does not carry a prior product's verification level into a lookup without one", async () => {
    mockServerFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ...SUCCESS_BODY,
        barcode: "012345678905",
        verificationLevel: "verified",
      }),
    });
    const { result, rerender } = renderLookup("012345678905");
    await waitFor(() =>
      expect(result.current.verificationLevel).toBe("verified"),
    );

    mockServerFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ...SUCCESS_BODY,
        productName: "Other Snack",
        barcode: "098765432109",
      }),
    });
    rerender({ barcode: "098765432109" });

    await waitFor(() =>
      expect(result.current.nutrition?.productName).toBe("Other Snack"),
    );
    expect(result.current.verificationLevel).toBe("unverified");
  });

  it("does not carry a prior product's front-label flag into a lookup that fails", async () => {
    mockApiRequest.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ hasFrontLabelData: true }),
    });
    mockServerFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ...SUCCESS_BODY, barcode: "012345678905" }),
    });
    const { result, rerender } = renderLookup("012345678905");
    await waitFor(() => expect(result.current.hasFrontLabelData).toBe(true));

    mockServerFetch.mockRejectedValueOnce(new Error("network down"));
    mockServerFetch.mockRejectedValueOnce(new Error("off unreachable"));
    rerender({ barcode: "00000000" });

    await waitFor(() =>
      expect(result.current.nutrition?.barcode).toBe("00000000"),
    );
    expect(result.current.hasFrontLabelData).toBe(false);
  });
});
