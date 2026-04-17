import { describe, it, expect } from "vitest";
import { inferCuisine, inferDietTags } from "../recipe-tag-inference";

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
