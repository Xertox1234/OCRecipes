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

/**
 * Regression cover for the silent unreadable-label fallback.
 *
 * Observed on-device 2026-07-28 on Cherry Coke (`06772408`), whose
 * OpenFoodFacts record is low by ~3.8x. Two scans of the SAME product with the
 * SAME user action diverged: one read the label and showed 140 kcal with the
 * conflict UI, the other failed to read it and showed 39 kcal with no conflict
 * UI, no error, and nothing to distinguish it from a verified reading.
 *
 * The whole point of the label step is products whose database entry is wrong —
 * precisely when a silent fallback does the most damage.
 */
describe("useNutritionLookup — unreadable nutrition label", () => {
  const mockServerFetch = vi.fn();

  // The DB record under test: deliberately the wrong-by-3.8x shape, so a silent
  // fallback here is the exact harm the notice exists to prevent.
  const wrongDbRecord = {
    productName: "Cherry Coke",
    brandName: "Coca-Cola",
    barcode: "06772408",
    per100g: { calories: 11.11, protein: 0, carbs: 3.1, fat: 0 },
    perServing: { calories: 39.4, protein: 0, carbs: 11, fat: 0 },
    servingInfo: { displayLabel: "355 mL", grams: 355, wasCorrected: false },
    isServingDataTrusted: true,
    source: "openfoodfacts",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mockServerFetch);
    mockApiRequest.mockResolvedValue({
      ok: true,
      json: async () => ({ hasFrontLabelData: false }),
    });
    mockServerFetch.mockResolvedValue({
      ok: true,
      json: async () => wrongDbRecord,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const render = (ocrText?: string | null) => {
    const { wrapper } = createQueryWrapper();
    return renderHook(
      () => useNutritionLookup({ barcode: "06772408", ocrText }),
      { wrapper },
    );
  };

  it("tells the user the label could not be read when OCR produced nothing", async () => {
    const { result } = render(null);

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.labelReadNotice).toBeTruthy();
    expect(result.current.labelReadNotice).toMatch(/couldn't read/i);
    // Must offer the recovery, not just state the failure.
    expect(result.current.labelReadNotice).toMatch(/retake/i);
  });

  it("does not blame the database — it says the label was not used", async () => {
    const { result } = render(null);

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // The DB value may well be correct; the honest claim is only that the
    // photographed label was not applied.
    expect(result.current.labelReadNotice).not.toMatch(/wrong|incorrect|bad/i);
    expect(result.current.labelReadNotice).toMatch(/product database/i);
  });

  it("distinguishes an unreadable label from one with no nutrition values on it", async () => {
    const { result: blurry } = render(null);
    await waitFor(() => expect(blurry.current.isLoading).toBe(false));

    // Legible text, but it is the front of the pack — no nutrition panel.
    const { result: wrongSide } = render("CHERRY COKE ZERO SUGAR 355 mL");
    await waitFor(() => expect(wrongSide.current.isLoading).toBe(false));

    expect(blurry.current.labelReadNotice).toBeTruthy();
    expect(wrongSide.current.labelReadNotice).toBeTruthy();
    // Different failures deserve different guidance: retake vs photograph the
    // correct side. Identical copy would be a coin-flip for the user.
    expect(wrongSide.current.labelReadNotice).not.toBe(
      blurry.current.labelReadNotice,
    );
  });

  it("stays silent on a barcode-only scan, which never promised to use a label", async () => {
    const { result } = render(undefined);

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.labelReadNotice).toBeNull();
  });

  it("stays silent on the happy path so the warning keeps its meaning", async () => {
    const { result } = render(
      "Nutrition Facts\nServing Size 1 can (355 mL)\nCalories 140\nTotal Fat 0g\nTotal Sugars 42g",
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.labelReadNotice).toBeNull();
  });
});
