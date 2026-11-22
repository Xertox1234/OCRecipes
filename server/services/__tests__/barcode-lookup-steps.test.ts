import { describe, it, expect, vi } from "vitest";

import {
  buildSearchTermCandidates,
  extractOffPer100g,
  isOffSelfConsistent,
} from "../barcode-lookup-steps";

// nutrition-lookup (imported for the OFF nutriments schema) reaches the db
// module at import time; these are network-free pure tests, so stub it.
vi.mock("../../db", () => ({ db: {} }));

describe("buildSearchTermCandidates", () => {
  it("returns [] for no OFF product", () => {
    expect(buildSearchTermCandidates(null)).toEqual([]);
  });

  it("orders en name, en generic, categories (most specific first), generic, name", () => {
    expect(
      buildSearchTermCandidates({
        product_name_en: "Sugar EN",
        generic_name_en: "Granulated sugar",
        categories_tags: ["en:sweeteners", "fr:sucres", "en:white-sugars"],
        generic_name: "Sucre",
        product_name: "Sucre Blanc",
      }),
    ).toEqual([
      "Sugar EN",
      "Granulated sugar",
      "white sugars",
      "sweeteners",
      "Sucre",
      "Sucre Blanc",
    ]);
  });

  it("skips blank categories and missing fields", () => {
    expect(
      buildSearchTermCandidates({ categories_tags: ["en:", "en:snacks"] }),
    ).toEqual(["snacks"]);
  });
});

describe("extractOffPer100g", () => {
  it("converts units and reads per-serving energy", () => {
    const r = extractOffPer100g({
      nutriments: {
        "energy-kcal_100g": 400,
        "energy-kcal_serving": 120,
        proteins_100g: 5,
        sodium_100g: 0.4,
        cholesterol_100g: 0.02,
        energy_100g: 1674,
      },
    });
    expect(r.per100g.calories).toBe(400);
    expect(r.per100g.sodium).toBe(400);
    expect(r.per100g.cholesterol).toBe(20);
    expect(r.perServingCalories).toBe(120);
    expect(r.energyKj.per100g).toBe(1674);
    expect(r.dropped).toEqual([]);
  });

  it("handles a missing product", () => {
    const r = extractOffPer100g(null);
    expect(r.per100g.calories).toBeUndefined();
    expect(r.perServingCalories).toBeUndefined();
  });

  it("drops implausible values and reports them", () => {
    const r = extractOffPer100g({ nutriments: { proteins_100g: 450 } });
    expect(r.per100g.protein).toBeUndefined();
    expect(r.dropped.length).toBeGreaterThan(0);
  });
});

describe("isOffSelfConsistent", () => {
  const noKj = { per100g: undefined, perServing: undefined };

  it("is false without per-100g calories", () => {
    expect(
      isOffSelfConsistent({
        per100g: {},
        perServingCalories: 100,
        labelGrams: 30,
        energyKj: noKj,
      }),
    ).toBe(false);
  });

  it("accepts per-serving agreeing with per-100g x grams", () => {
    expect(
      isOffSelfConsistent({
        per100g: { calories: 400 },
        perServingCalories: 120,
        labelGrams: 30,
        energyKj: noKj,
      }),
    ).toBe(true);
  });

  it("rejects a ratio disagreement", () => {
    expect(
      isOffSelfConsistent({
        per100g: { calories: 400 },
        perServingCalories: 60,
        labelGrams: 30,
        energyKj: noKj,
      }),
    ).toBe(false);
  });

  it("rescues low-calorie rounding via the 5 kcal floor", () => {
    expect(
      isOffSelfConsistent({
        per100g: { calories: 20 },
        perServingCalories: 5,
        labelGrams: 5,
        energyKj: noKj,
      }),
    ).toBe(true);
  });

  it("treats explicit zeros as agreement unless macros or kJ contradict", () => {
    const base = { perServingCalories: 0, labelGrams: null };
    expect(
      isOffSelfConsistent({
        ...base,
        per100g: { calories: 0 },
        energyKj: noKj,
      }),
    ).toBe(true);
    expect(
      isOffSelfConsistent({
        ...base,
        per100g: { calories: 0, carbs: 50 },
        energyKj: noKj,
      }),
    ).toBe(false);
    expect(
      isOffSelfConsistent({
        ...base,
        per100g: { calories: 0 },
        energyKj: { per100g: 100, perServing: undefined },
      }),
    ).toBe(false);
  });

  it("rejects zero per-100g with nonzero per-serving", () => {
    expect(
      isOffSelfConsistent({
        per100g: { calories: 0 },
        perServingCalories: 50,
        labelGrams: 30,
        energyKj: noKj,
      }),
    ).toBe(false);
  });

  it("falls back to Atwater when serving grams are unparseable", () => {
    // 4*10 + 4*50 + 9*10 = 330 kcal
    expect(
      isOffSelfConsistent({
        per100g: { calories: 330, protein: 10, carbs: 50, fat: 10 },
        perServingCalories: 100,
        labelGrams: null,
        energyKj: noKj,
      }),
    ).toBe(true);
  });
});
