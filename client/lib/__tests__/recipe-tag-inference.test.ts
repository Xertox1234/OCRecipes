import { describe, it, expect } from "vitest";
import { inferCuisine, inferDietTags } from "../recipe-tag-inference";
import { DIET_TAG_OPTIONS } from "../../components/recipe-wizard/types";

describe("inferCuisine", () => {
  it("infers Italian from parmesan and marinara", () => {
    expect(
      inferCuisine("Chicken Parmesan", [
        "parmesan",
        "marinara sauce",
        "mozzarella",
      ]),
    ).toBe("Italian");
  });

  it("infers Mexican from tortilla and salsa", () => {
    expect(inferCuisine("Fish Tacos", ["tortilla", "salsa", "avocado"])).toBe(
      "Mexican",
    );
  });

  it("infers Japanese from sushi-related terms", () => {
    expect(
      inferCuisine("Salmon Sushi Roll", ["sushi rice", "nori", "salmon"]),
    ).toBe("Japanese");
  });

  it("returns null when no cuisine matches", () => {
    expect(
      inferCuisine("My Special Dish", ["salt", "pepper", "water"]),
    ).toBeNull();
  });

  it("matches from title even when ingredients are empty", () => {
    expect(inferCuisine("Thai Basil Chicken", [])).toBe("Thai");
  });

  it("is case-insensitive", () => {
    expect(
      inferCuisine("CHICKEN TIKKA MASALA", ["GARAM MASALA", "YOGURT"]),
    ).toBe("Indian");
  });
});

describe("inferDietTags", () => {
  it("suggests Vegetarian when no meat ingredients", () => {
    const tags = inferDietTags(["flour", "sugar", "butter", "eggs"]);
    expect(tags).toContain("Vegetarian");
  });

  it("does not suggest Vegetarian when meat is present", () => {
    const tags = inferDietTags(["chicken breast", "rice", "soy sauce"]);
    expect(tags).not.toContain("Vegetarian");
  });

  it("suggests Vegan when no meat or dairy", () => {
    const tags = inferDietTags(["tofu", "rice", "soy sauce", "vegetables"]);
    expect(tags).toContain("Vegan");
    expect(tags).toContain("Vegetarian");
  });

  it("does not suggest Vegan when dairy is present", () => {
    const tags = inferDietTags(["pasta", "butter", "cream"]);
    expect(tags).not.toContain("Vegan");
  });

  it("suggests Gluten Free when no gluten ingredients", () => {
    const tags = inferDietTags(["chicken", "rice", "vegetables"]);
    expect(tags).toContain("Gluten Free");
  });

  it("does not suggest Gluten Free when flour is present", () => {
    const tags = inferDietTags(["flour", "sugar", "eggs"]);
    expect(tags).not.toContain("Gluten Free");
  });

  it("suggests Dairy Free when no dairy ingredients", () => {
    const tags = inferDietTags(["chicken", "rice", "soy sauce"]);
    expect(tags).toContain("Dairy Free");
  });

  it("returns empty array for empty ingredients", () => {
    expect(inferDietTags([])).toEqual([]);
  });
});

describe("inferDietTags — DIET_TAG_OPTIONS coverage", () => {
  // L20 follow-up: enumerate every option in DIET_TAG_OPTIONS and assert the
  // expected inference behavior (covered vs intentionally not inferred).
  //
  // Covered by ingredient heuristics:
  const COVERED: readonly (typeof DIET_TAG_OPTIONS)[number][] = [
    "Vegetarian",
    "Vegan",
    "Gluten Free",
    "Dairy Free",
  ];

  // Intentionally NOT inferred — require macronutrient data.
  const NOT_INFERRED: readonly (typeof DIET_TAG_OPTIONS)[number][] = [
    "Keto",
    "Paleo",
    "Low Carb",
    "High Protein",
  ];

  it("DIET_TAG_OPTIONS is exhaustively partitioned", () => {
    const partitioned = new Set([...COVERED, ...NOT_INFERRED]);
    expect(partitioned.size).toBe(DIET_TAG_OPTIONS.length);
    for (const tag of DIET_TAG_OPTIONS) {
      expect(partitioned.has(tag)).toBe(true);
    }
  });

  it("Vegetarian: returned when ingredients contain no meat", () => {
    expect(inferDietTags(["rice", "beans", "tomato"])).toContain("Vegetarian");
  });

  it("Vegan: returned when ingredients contain no meat, dairy, or eggs", () => {
    expect(inferDietTags(["tofu", "rice", "broccoli"])).toContain("Vegan");
  });

  it("Gluten Free: returned when ingredients contain no gluten", () => {
    expect(inferDietTags(["rice", "chicken", "broccoli"])).toContain(
      "Gluten Free",
    );
  });

  it("Dairy Free: returned when ingredients contain no dairy", () => {
    expect(inferDietTags(["chicken", "rice", "soy sauce"])).toContain(
      "Dairy Free",
    );
  });

  it("Keto: NOT inferred (requires macro data, not ingredient names)", () => {
    // Even a clearly low-carb ingredient list should not trigger Keto.
    expect(inferDietTags(["chicken", "avocado", "olive oil"])).not.toContain(
      "Keto",
    );
  });

  it("Paleo: NOT inferred (requires ingredient whitelist + macro context)", () => {
    expect(inferDietTags(["chicken", "avocado", "olive oil"])).not.toContain(
      "Paleo",
    );
  });

  it("Low Carb: NOT inferred (requires net-carb computation)", () => {
    expect(inferDietTags(["chicken", "avocado", "olive oil"])).not.toContain(
      "Low Carb",
    );
  });

  it("High Protein: NOT inferred (requires protein % per serving)", () => {
    expect(
      inferDietTags(["chicken breast", "egg whites", "cottage cheese"]),
    ).not.toContain("High Protein");
  });

  for (const tag of NOT_INFERRED) {
    it(`never emits "${tag}" from any sample ingredient list`, () => {
      const samples: string[][] = [
        ["chicken", "avocado", "olive oil"],
        ["beef", "lettuce", "cheese"],
        ["egg whites", "spinach", "salmon"],
        ["flour", "sugar", "butter"],
        ["rice", "beans", "tomato"],
      ];
      for (const sample of samples) {
        expect(inferDietTags(sample)).not.toContain(tag);
      }
    });
  }
});
