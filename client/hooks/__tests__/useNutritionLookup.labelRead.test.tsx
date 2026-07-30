// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { useNutritionLookup } from "../useNutritionLookup";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";

const { mockGoBack, mockApiRequest, mockTokenGet } = vi.hoisted(() => ({
  mockGoBack: vi.fn(),
  mockApiRequest: vi.fn(),
  mockTokenGet: vi.fn(),
}));

/**
 * Flips `tokenStorage.get` to reject. That is the ONE realistic failure that
 * throws BEFORE the hook sets `labelUsed` from `labelReady`, which is what makes
 * the stale-`labelUsed` regression test below discriminating. See its comment.
 */
let failKeychainRead = false;

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
  tokenStorage: { get: mockTokenGet, set: vi.fn(), clear: vi.fn() },
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

  /** Proven `labelReady === true` by the happy-path test at the end of this file. */
  const READABLE_LABEL =
    "Nutrition Facts\nServing Size 1 can (355 mL)\nCalories 140\nTotal Fat 0g\nTotal Sugars 42g";

  beforeEach(() => {
    vi.clearAllMocks();
    failKeychainRead = false;
    vi.stubGlobal("fetch", mockServerFetch);
    // A mutable flag rather than mockRejectedValueOnce: clearAllMocks does not
    // drain a once-queue, so an unconsumed rejection would leak into the next
    // test in this file.
    mockTokenGet.mockImplementation(async () => {
      if (failKeychainRead) throw new Error("keychain unavailable");
      return "test-token";
    });
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
    const { result } = render(READABLE_LABEL);

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.labelReadNotice).toBeNull();
  });

  /**
   * `labelUsed` is state that OUTLIVES a single lookup, so a lookup that never
   * reaches the point where it is assigned would otherwise inherit the previous
   * lookup's `true` — and `deriveLogGate` would report `open` for numbers that
   * came from the database. That is the exact one-tap wrong-calorie write this
   * whole feature exists to stop, so it gets its own regression test.
   */
  describe("logGate across consecutive lookups on one screen instance", () => {
    // The OFF fallback's own payload shape. Same wrong-by-3.8x record as the
    // server's, reached directly because the server leg never ran.
    const offFallbackRecord = {
      status: 1,
      product: {
        product_name: "Cherry Coke",
        brands: "Coca-Cola",
        nutriments: {
          "energy-kcal_100g": 11.11,
          proteins_100g: 0,
          carbohydrates_100g: 3.1,
          fat_100g: 0,
        },
        serving_size: "355 ml",
      },
    };

    it("re-gates a retaken label that could not be read, after one that was used", async () => {
      const { wrapper } = createQueryWrapper();
      const { result, rerender } = renderHook(
        (props: { ocrText?: string | null }) =>
          useNutritionLookup({ barcode: "06772408", ocrText: props.ocrText }),
        { wrapper, initialProps: { ocrText: READABLE_LABEL } },
      );

      await waitFor(() => expect(result.current.isLoading).toBe(false));
      // Negative control. Without this the assertion below could pass simply
      // because the gate was never open in the first place.
      expect(result.current.logGate).toEqual({ kind: "open" });

      // The user takes the notice's advice and retakes the label — same barcode,
      // same screen instance, and this time OCR yields nothing. The keychain read
      // also fails, so the whole server leg is skipped and the direct-OFF
      // fallback supplies the numbers.
      //
      // That combination is what makes this test discriminating: the hook assigns
      // `labelUsed` from `labelReady` BEFORE it fetches, so every failure AFTER
      // that point still clears the flag. A `tokenStorage.get` rejection is the
      // one realistic failure that throws BEFORE it, leaving the per-lookup reset
      // as the only thing that can clear the previous lookup's `true`.
      failKeychainRead = true;
      mockServerFetch.mockResolvedValue({
        ok: true,
        json: async () => offFallbackRecord,
      });

      rerender({ ocrText: null });

      // `isLoading` is already false and is not re-armed, and the keychain
      // rejection means `labelReadNotice` is never set either — so wait on the
      // OFF fallback's own side effect: its fail-safe "couldn't check allergens"
      // flag, which only that branch sets.
      await waitFor(() => expect(result.current.flags).toHaveLength(1));

      expect(result.current.logGate).toEqual({
        kind: "needsAcknowledgement",
        buttonLabel: "Review values before logging",
      });
    });
  });
});
