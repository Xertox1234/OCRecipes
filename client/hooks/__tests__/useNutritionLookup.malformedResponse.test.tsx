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

// A malformed 200: `serverRes.ok` is true but the body doesn't match
// `barcodeLookupResponseSchema` — it is missing `servingInfo`,
// `isServingDataTrusted`, `per100g` and `perServing` entirely, which the
// pre-fix code dereferenced directly (`data.servingInfo.wasCorrected`)
// and threw, landing in the network-failure catch with only a dev-only
// `logger.warn` and the "couldn't reach our service" copy.
const MALFORMED_SERVER_BODY = {
  productName: "Weird Snack",
  barcode: "000000000005",
};

describe("useNutritionLookup — malformed barcode lookup response (M7)", () => {
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

  it("logs a validation error, falls back to OFF for values, and does NOT claim we couldn't reach the service", async () => {
    const errorSpy = vi
      .spyOn(logger, "error")
      .mockImplementation(() => undefined);
    const warnSpy = vi
      .spyOn(logger, "warn")
      .mockImplementation(() => undefined);

    mockServerFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => MALFORMED_SERVER_BODY,
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
      () => useNutritionLookup({ barcode: "000000000005" }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // The OFF fallback actually ran and produced real values — this is not a
    // total outage.
    expect(result.current.nutrition?.productName).toBe("Fallback Snack");

    // The allergen fail-safe flag is still shown (behavior preserved)...
    expect(result.current.flags).toHaveLength(1);
    const [flag] = result.current.flags;
    expect(flag).toEqual(
      expect.objectContaining({
        id: "allergen-unavailable",
        kind: "allergen-unavailable",
        severity: "warn",
        tier: "safety",
      }),
    );
    // ...but its copy must not claim we couldn't reach the service — the
    // server responded; the body just didn't validate.
    expect(flag.detail).not.toMatch(/couldn't reach our service/i);

    // The validation failure is reported with `logger.error` (reaches
    // Sentry), and is NOT also reported as a network-outage `logger.warn`.
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();

    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  // Positive control for the branch this fix left unchanged: a genuine
  // connectivity failure must still warn (not error) and still tell the user
  // we couldn't reach the service. Without this, inverting the
  // `serverResponseInvalid` guard would ship with every test green.
  it("still reports a genuine network failure as unreachable, via logger.warn", async () => {
    const errorSpy = vi
      .spyOn(logger, "error")
      .mockImplementation(() => undefined);
    const warnSpy = vi
      .spyOn(logger, "warn")
      .mockImplementation(() => undefined);

    mockServerFetch
      .mockRejectedValueOnce(new TypeError("Network request failed"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 1,
          product: {
            product_name: "Fallback Snack",
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
      () => useNutritionLookup({ barcode: "000000000006" }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.flags).toHaveLength(1);
    expect(result.current.flags[0].detail).toBe(
      "We couldn't reach our service to check this against your allergies — check the package label.",
    );
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();

    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("still fails safe when the OFF fallback ALSO fails after a malformed 200", async () => {
    const errorSpy = vi
      .spyOn(logger, "error")
      .mockImplementation(() => undefined);
    const warnSpy = vi
      .spyOn(logger, "warn")
      .mockImplementation(() => undefined);

    mockServerFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => MALFORMED_SERVER_BODY,
      })
      .mockRejectedValueOnce(new Error("OFF unreachable"));

    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(
      () => useNutritionLookup({ barcode: "000000000006" }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe("Failed to fetch product data");
    expect(result.current.flags).toHaveLength(1);
    const [flag] = result.current.flags;
    expect(flag).toEqual(
      expect.objectContaining({
        id: "allergen-unavailable",
        kind: "allergen-unavailable",
        severity: "warn",
        tier: "safety",
      }),
    );
    expect(flag.detail).not.toMatch(/couldn't reach our service/i);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();

    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  // Pins the `.catch(() => undefined)` guard around `serverRes.json()`
  // itself: a 200 with a body that isn't even valid JSON is also a
  // malformed response, and must land in the same `safeParse` failure path
  // as a shape mismatch rather than throwing and being swallowed by the
  // network-failure catch.
  it("treats an unparseable 200 body (bad JSON) the same as a shape mismatch", async () => {
    const errorSpy = vi
      .spyOn(logger, "error")
      .mockImplementation(() => undefined);
    const warnSpy = vi
      .spyOn(logger, "warn")
      .mockImplementation(() => undefined);

    mockServerFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new SyntaxError("Unexpected token < in JSON at position 0");
        },
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
      () => useNutritionLookup({ barcode: "000000000007" }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.nutrition?.productName).toBe("Fallback Snack");
    const [flag] = result.current.flags;
    expect(flag.detail).not.toMatch(/couldn't reach our service/i);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();

    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
