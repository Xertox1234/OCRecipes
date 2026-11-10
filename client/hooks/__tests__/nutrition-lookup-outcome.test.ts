import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  lookupBarcode,
  lookupStateFromOutcome,
  beginLookup,
  INITIAL_LOOKUP_STATE,
  type LookupOutcome,
  type LookupState,
  type DbSnapshot,
  type ConflictState,
  type NutritionData,
} from "../nutrition-lookup-outcome";
import { logger } from "@/lib/logger";
import { createAllergenUnavailableFlag } from "@shared/types/scan-flags";
import type { ValidatedNutrition } from "@/lib/serving-size-utils";

const { mockApiRequest, mockTokenGet } = vi.hoisted(() => ({
  mockApiRequest: vi.fn(),
  mockTokenGet: vi.fn(),
}));

vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
  getApiUrl: () => "http://localhost:3000",
}));

vi.mock("@/lib/token-storage", () => ({
  tokenStorage: { get: mockTokenGet, set: vi.fn(), clear: vi.fn() },
}));

// ---------------------------------------------------------------------------
// lookupBarcode — one test per LookupOutcome kind, plus both allergenFlag
// copy variants on the two fail-safe kinds.
// ---------------------------------------------------------------------------

describe("lookupBarcode", () => {
  const mockFetch = vi.fn();

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
      flags: [],
      verificationLevel: "unverified",
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mockFetch);
    mockTokenGet.mockResolvedValue("test-token");
    mockApiRequest.mockResolvedValue({
      ok: true,
      json: async () => ({ hasFrontLabelData: false }),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves 'server-ok' for a clean 200 with no conflict", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => baseBody(),
    });

    const outcome = await lookupBarcode("06772408", undefined);

    expect(outcome.kind).toBe("server-ok");
    if (outcome.kind !== "server-ok") throw new Error("wrong outcome kind");
    expect(outcome.nutrition.productName).toBe("Cherry Coke");
    expect(outcome.nutrition.calories).toBe(39);
    expect(outcome.servingSizeGrams).toBe(355);
    expect(outcome.isPer100g).toBe(false);
    expect(outcome.dbSnapshot.nutrition.calories).toBe(39);
    expect(outcome.labelReadNotice).toBeNull();
    expect(outcome.labelUsed).toBe(false);
    expect(outcome.hasFrontLabelData).toBe(false);
    expect(outcome.correctionNotice).toBeNull();
  });

  it("resolves 'server-ok-conflict' when the server reports a label conflict", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () =>
        baseBody({
          servingInfo: {
            displayLabel: "355 ml",
            grams: 355,
            wasCorrected: true,
            correctionReason: "DB serving corrected",
          },
          conflict: {
            fields: ["calories"],
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
            }),
          },
        }),
    });

    const outcome = await lookupBarcode("06772408", "some ocr text");

    expect(outcome.kind).toBe("server-ok-conflict");
    if (outcome.kind !== "server-ok-conflict") {
      throw new Error("wrong outcome kind");
    }
    // Active values are the LABEL's.
    expect(outcome.nutrition.calories).toBe(150);
    // dbSnapshot keeps the DB's values.
    expect(outcome.dbSnapshot.nutrition.calories).toBe(39);
    expect(outcome.conflict.fields).toEqual(["calories"]);
    expect(outcome.conflict.labelNutrition.calories).toBe(150);
    // correctionNotice comes from the DB's servingInfo, not the label's.
    expect(outcome.correctionNotice).toBe("DB serving corrected");
  });

  it("resolves 'not-in-database' on a 404 with notInDatabase", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ notInDatabase: true }),
    });

    const outcome = await lookupBarcode("00000000", undefined);

    expect(outcome.kind).toBe("not-in-database");
    if (outcome.kind !== "not-in-database")
      throw new Error("wrong outcome kind");
    expect(outcome.nutrition).toEqual({
      productName: "Product Not Found",
      barcode: "00000000",
    });
  });

  // Privacy audit M1: the phone never contacts Open Food Facts directly — that
  // exposed the user's IP address to a third party. Every answer from our
  // server that is not a product is classified from that answer alone.
  function expectOnlyOurServer() {
    expect(mockFetch).toHaveBeenCalledTimes(1);
    for (const [url] of mockFetch.mock.calls) {
      expect(String(url)).not.toMatch(/openfoodfacts/i);
    }
  }

  it("resolves 'not-found' on the server's plain 404, without contacting OFF", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: "Product not found", code: "NOT_FOUND" }),
    });

    const outcome = await lookupBarcode("000000000006", undefined);

    expect(outcome.kind).toBe("not-found");
    if (outcome.kind !== "not-found") throw new Error("wrong outcome kind");
    expect(outcome.error).toBe("Product not found in database");
    expect(outcome.nutrition).toEqual({
      productName: "Unknown Product",
      barcode: "000000000006",
    });
    expectOnlyOurServer();
  });

  it("server unreachable: total-outage with the plain copy, without contacting OFF", async () => {
    mockFetch.mockRejectedValueOnce(new Error("server unreachable"));

    const outcome = await lookupBarcode("000000000007", undefined);

    expect(outcome.kind).toBe("total-outage");
    if (outcome.kind !== "total-outage") throw new Error("wrong outcome kind");
    expect(outcome.error).toBe("Failed to fetch product data");
    expect(outcome.allergenFlag.kind).toBe("allergen-unavailable");
    expect(outcome.allergenFlag.detail).toBe(
      "We couldn't reach our service to check this against your allergies — check the package label.",
    );
    expectOnlyOurServer();
  });

  it("server 500: total-outage, without contacting OFF", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: "boom" }),
    });

    const outcome = await lookupBarcode("000000000003", undefined);

    expect(outcome.kind).toBe("total-outage");
    expectOnlyOurServer();
  });

  it("server 503: retry copy (total-outage), not 'Product not found'", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({ code: "NUTRITION_LOOKUP_FAILED" }),
    });

    const outcome = await lookupBarcode("000000000008", undefined);

    expect(outcome.kind).toBe("total-outage");
    if (outcome.kind !== "total-outage") throw new Error("wrong outcome kind");
    expect(outcome.error).toMatch(/try scanning again/i);
    expect(outcome.error).not.toMatch(/not found/i);
    expect(outcome.allergenFlag.detail).toBe(
      "We couldn't reach our product sources to check this against your allergies — check the package label.",
    );
    expectOnlyOurServer();
  });

  it("malformed server 200: total-outage with the schema-invalid copy", async () => {
    const errorSpy = vi
      .spyOn(logger, "error")
      .mockImplementation(() => undefined);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        productName: "Weird Snack",
        barcode: "000000000005",
      }),
    });

    const outcome = await lookupBarcode("000000000005", undefined);

    expect(outcome.kind).toBe("total-outage");
    if (outcome.kind !== "total-outage") throw new Error("wrong outcome kind");
    expect(outcome.error).toBe("Failed to fetch product data");
    expect(outcome.allergenFlag.detail).toBe(
      "Our service sent back information we couldn't understand, so we couldn't check this against your allergies — check the package label.",
    );
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expectOnlyOurServer();

    errorSpy.mockRestore();
  });

  it("never rejects — a synchronous throw from a network call still resolves a LookupOutcome", async () => {
    mockFetch.mockImplementation(() => {
      throw new Error("boom");
    });

    await expect(lookupBarcode("00000000", undefined)).resolves.toMatchObject({
      kind: "total-outage",
    });
  });
});

// ---------------------------------------------------------------------------
// lookupStateFromOutcome — one test per kind, built from hand-constructed
// outcomes (no fetch involved).
// ---------------------------------------------------------------------------

describe("lookupStateFromOutcome", () => {
  const nutrition: NutritionData = {
    productName: "Product X",
    barcode: "123",
    calories: 100,
  };
  const validated: ValidatedNutrition = {
    perServing: { calories: 100 },
    per100g: { calories: 25 },
    servingInfo: { displayLabel: "4 pieces", grams: 100, wasCorrected: false },
    isServingDataTrusted: true,
  };
  const dbSnapshot: DbSnapshot = {
    nutrition,
    flags: [],
    validated,
    servingGrams: 100,
    isPer100g: false,
  };

  it("server-ok: activeSource database, dbSnapshot carried, conflict cleared", () => {
    const outcome: LookupOutcome = {
      kind: "server-ok",
      labelReadNotice: null,
      nutrition,
      flags: [],
      validatedData: validated,
      servingSizeGrams: 100,
      isPer100g: false,
      correctionNotice: null,
      dbSnapshot,
      labelUsed: true,
      verificationLevel: "verified",
      isBeverage: true,
      hasFrontLabelData: true,
    };

    const state = lookupStateFromOutcome(outcome);

    expect(state.activeSource).toBe("database");
    expect(state.conflict).toBeNull();
    expect(state.dbSnapshot).toBe(dbSnapshot);
    expect(state.verificationLevel).toBe("verified");
    expect(state.labelUsed).toBe(true);
    expect(state.showManualSearch).toBe(false);
    expect(state.error).toBeNull();
  });

  it("server-ok: defaults verificationLevel to 'unverified' when the outcome omits it", () => {
    const outcome: LookupOutcome = {
      kind: "server-ok",
      labelReadNotice: null,
      nutrition,
      flags: [],
      validatedData: validated,
      servingSizeGrams: 100,
      isPer100g: false,
      correctionNotice: null,
      dbSnapshot,
      labelUsed: false,
      verificationLevel: undefined,
      isBeverage: null,
      hasFrontLabelData: false,
    };

    const state = lookupStateFromOutcome(outcome);

    expect(state.verificationLevel).toBe("unverified");
  });

  it("server-ok-conflict: label values active, activeSource label, dbSnapshot = DB values, correctionNotice from DB", () => {
    const labelNutrition: NutritionData = {
      productName: "Label X",
      barcode: "123",
      calories: 150,
    };
    const labelValidated: ValidatedNutrition = {
      perServing: { calories: 150 },
      per100g: { calories: 42 },
      servingInfo: { displayLabel: "1 can", grams: 355, wasCorrected: false },
      isServingDataTrusted: true,
    };
    const conflict: ConflictState = {
      fields: ["calories"],
      labelNutrition,
      labelFlags: [],
      labelValidated,
      labelGrams: 355,
      labelIsPer100g: false,
    };
    const outcome: LookupOutcome = {
      kind: "server-ok-conflict",
      labelReadNotice: null,
      nutrition: labelNutrition,
      flags: [],
      validatedData: labelValidated,
      servingSizeGrams: 355,
      isPer100g: false,
      // Deliberately from the DB leg, distinct from anything on `conflict`.
      correctionNotice: "DB serving corrected",
      dbSnapshot,
      labelUsed: true,
      verificationLevel: "unverified",
      isBeverage: null,
      hasFrontLabelData: false,
      conflict,
    };

    const state = lookupStateFromOutcome(outcome);

    expect(state.activeSource).toBe("label");
    expect(state.nutrition).toBe(labelNutrition);
    expect(state.validatedData).toBe(labelValidated);
    expect(state.servingSizeGrams).toBe(355);
    expect(state.conflict).toBe(conflict);
    // dbSnapshot stays the DB's values, unaffected by the label being active.
    expect(state.dbSnapshot).toBe(dbSnapshot);
    expect(state.dbSnapshot?.nutrition.calories).toBe(100);
    expect(state.correctionNotice).toBe("DB serving corrected");
  });

  it("not-in-database: showManualSearch true, no flag, otherwise defaulted", () => {
    const pnfNutrition: NutritionData = {
      productName: "Product Not Found",
      barcode: "999",
    };
    const outcome: LookupOutcome = {
      kind: "not-in-database",
      labelReadNotice: null,
      nutrition: pnfNutrition,
    };

    const state = lookupStateFromOutcome(outcome);

    expect(state.showManualSearch).toBe(true);
    expect(state.nutrition).toBe(pnfNutrition);
    // "No product ⇒ no flag" — pinned current behaviour.
    expect(state.flags).toEqual([]);
    expect(state.error).toBeNull();
    expect(state.validatedData).toBeNull();
  });

  it("not-found: error set, no flag", () => {
    const unk: NutritionData = {
      productName: "Unknown Product",
      barcode: "000",
    };
    const outcome: LookupOutcome = {
      kind: "not-found",
      labelReadNotice: null,
      nutrition: unk,
      error: "Product not found in database",
    };

    const state = lookupStateFromOutcome(outcome);

    expect(state.error).toBe("Product not found in database");
    // "No product ⇒ no flag" — pinned current behaviour, same as not-in-database.
    expect(state.flags).toEqual([]);
    expect(state.nutrition).toBe(unk);
  });

  it("total-outage: error set AND an allergen-unavailable flag", () => {
    const flag = createAllergenUnavailableFlag({ detail: "outage detail" });
    const unk: NutritionData = {
      productName: "Unknown Product",
      barcode: "000",
    };
    const outcome: LookupOutcome = {
      kind: "total-outage",
      labelReadNotice: null,
      nutrition: unk,
      error: "Failed to fetch product data",
      allergenFlag: flag,
    };

    const state = lookupStateFromOutcome(outcome);

    expect(state.error).toBe("Failed to fetch product data");
    expect(state.flags).toEqual([flag]);
    expect(state.nutrition).toBe(unk);
  });
});

// ---------------------------------------------------------------------------
// beginLookup
// ---------------------------------------------------------------------------

describe("beginLookup", () => {
  it("carries over ONLY nutrition and servingSizeGrams — every other field resets to its initial value", () => {
    const priorNutrition: NutritionData = {
      productName: "Prior Product",
      barcode: "1",
      calories: 250,
    };
    const priorFlag = createAllergenUnavailableFlag({ detail: "stale" });
    const priorValidated: ValidatedNutrition = {
      perServing: { calories: 250 },
      per100g: { calories: 62.5 },
      servingInfo: {
        displayLabel: "1 bottle",
        grams: 400,
        wasCorrected: false,
      },
      isServingDataTrusted: true,
    };
    const priorDbSnapshot: DbSnapshot = {
      nutrition: priorNutrition,
      flags: [priorFlag],
      validated: priorValidated,
      servingGrams: 400,
      isPer100g: false,
    };
    const priorConflict: ConflictState = {
      fields: ["calories"],
      labelNutrition: priorNutrition,
      labelFlags: [priorFlag],
      labelValidated: priorValidated,
      labelGrams: 400,
      labelIsPer100g: false,
    };

    const prev: LookupState = {
      nutrition: priorNutrition,
      flags: [priorFlag],
      verificationLevel: "verified",
      isBeverage: true,
      hasFrontLabelData: true,
      error: "some prior error",
      isPer100g: true,
      servingSizeGrams: 200,
      validatedData: priorValidated,
      correctionNotice: "prior notice",
      labelReadNotice: "prior label notice",
      labelUsed: true,
      showManualSearch: true,
      conflict: priorConflict,
      dbSnapshot: priorDbSnapshot,
      activeSource: "label",
    };

    const next = beginLookup(prev);

    expect(next.nutrition).toBe(priorNutrition);
    expect(next.servingSizeGrams).toBe(200);
    expect(next).toEqual({
      ...INITIAL_LOOKUP_STATE,
      nutrition: priorNutrition,
      servingSizeGrams: 200,
    });
  });

  it("starting from INITIAL_LOOKUP_STATE is a no-op", () => {
    expect(beginLookup(INITIAL_LOOKUP_STATE)).toEqual(INITIAL_LOOKUP_STATE);
  });
});
