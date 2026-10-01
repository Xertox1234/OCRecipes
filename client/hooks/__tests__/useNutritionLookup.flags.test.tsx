// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { useNutritionLookup } from "../useNutritionLookup";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";
import { logger } from "@/lib/logger";

const { mockGoBack, mockReset, mockPopTo, mockApiRequest } = vi.hoisted(() => ({
  mockGoBack: vi.fn(),
  mockReset: vi.fn(),
  mockPopTo: vi.fn(),
  mockApiRequest: vi.fn(),
}));

// `popTo` is stubbed even though nothing in this file exercises `handleAddToLog`
// today. The hook's log-success path calls `navigation.popTo(...)`, so the first
// success-path assertion added here would otherwise die with an opaque
// "popTo is not a function" TypeError instead of a meaningful failure.
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

  it("sets a couldn't-verify flag (not a client-computed allergen match) on the direct-OFF fallback path", async () => {
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

    // The server-side allergen check never ran (server was unreachable), so
    // the fallback surfaces an honest "couldn't verify" warn flag instead of
    // leaving `flags` empty (which would look allergen-clean). Phase 1 still
    // does not compute client-side allergen MATCHING — assert there is no
    // "allergen"-kind flag, only the unavailable signal.
    expect(result.current.flags).toEqual([
      expect.objectContaining({
        id: "allergen-unavailable",
        kind: "allergen-unavailable",
        severity: "warn",
        tier: "safety",
      }),
    ]);
    expect(result.current.flags.some((f) => f.kind === "allergen")).toBe(false);
  });

  it("sets the same couldn't-verify flag on total outage (server AND direct-OFF both fail)", async () => {
    // First call (server lookup) throws; second call (direct-OFF fallback)
    // also throws — the outer catch's fail-open [] left the screen looking
    // allergen-clean. It must be just as fail-safe as the single-failure path.
    mockServerFetch
      .mockRejectedValueOnce(new Error("server unreachable"))
      .mockRejectedValueOnce(new Error("OFF unreachable"));

    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(
      () => useNutritionLookup({ barcode: "000000000004" }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe("Failed to fetch product data");
    expect(result.current.flags).toEqual([
      expect.objectContaining({
        id: "allergen-unavailable",
        kind: "allergen-unavailable",
        severity: "warn",
        tier: "safety",
      }),
    ]);
  });
});

// Characterization tests added for P1-2026-09-23 (atomic lookup state
// refactor): pin exit paths not yet covered by the tests above, against
// BOTH the pre-refactor and post-refactor hook.
describe("useNutritionLookup — 5xx vs network-error OFF-fallback distinction (P1-2026-09-23 characterization)", () => {
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

  it("a 5xx server response falls back to OFF with the 'couldn't reach' copy and calls neither logger.warn nor logger.error", async () => {
    const warnSpy = vi
      .spyOn(logger, "warn")
      .mockImplementation(() => undefined);
    const errorSpy = vi
      .spyOn(logger, "error")
      .mockImplementation(() => undefined);

    mockServerFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: "internal" }),
      })
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
      () => useNutritionLookup({ barcode: "000000000010" }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.nutrition?.productName).toBe("Fallback Snack");
    expect(result.current.flags).toEqual([
      expect.objectContaining({
        id: "allergen-unavailable",
        detail:
          "We couldn't reach our service to check this against your allergies — check the package label.",
      }),
    ]);
    // A plain HTTP error status never throws inside the server-lookup try —
    // there is no catch to warn from, unlike a genuine connectivity failure.
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  // Positive control for the silence assertion above: a REAL connectivity
  // failure must still warn, or the "not called" assertion would be vacuous.
  it("a genuine network error falls back to OFF AND calls logger.warn", async () => {
    const warnSpy = vi
      .spyOn(logger, "warn")
      .mockImplementation(() => undefined);

    mockServerFetch
      .mockRejectedValueOnce(new Error("server unreachable"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 1,
          product: {
            product_name: "Fallback Snack",
            nutriments: { "energy-kcal_100g": 400 },
          },
        }),
      });

    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(
      () => useNutritionLookup({ barcode: "000000000011" }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });
});

describe("useNutritionLookup — off-not-found (P1-2026-09-23 characterization)", () => {
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

  it("server unreachable + OFF status !== 1 ⇒ 'Product not found', Unknown Product nutrition, no flag", async () => {
    mockServerFetch
      .mockRejectedValueOnce(new Error("server unreachable"))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 0 }) });

    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(
      () => useNutritionLookup({ barcode: "000000000012" }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe("Product not found in database");
    expect(result.current.nutrition).toEqual({
      productName: "Unknown Product",
      barcode: "000000000012",
    });
    // "No product ⇒ no flag" — pinned current behaviour, unlike the
    // off-fallback and total-outage paths.
    expect(result.current.flags).toEqual([]);
  });
});
