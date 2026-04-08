import { describe, it, expect } from "vitest";
import { generateRemixChips } from "../remix-chips";

describe("generateRemixChips", () => {
  const dairyRecipe = {
    ingredients: [
      { name: "butter" },
      { name: "milk" },
      { name: "chicken breast" },
      { name: "flour" },
      { name: "garlic" },
    ],
    dietTags: [],
  };

  const veganRecipe = {
    ingredients: [
      { name: "tofu" },
      { name: "rice" },
      { name: "broccoli" },
      { name: "soy sauce" },
    ],
    dietTags: ["vegan", "gluten-free"],
  };

  it("generates allergen chips when recipe contains user allergens", () => {
    const chips = generateRemixChips(dairyRecipe, {
      allergies: [{ name: "milk", severity: "moderate" }],
    });

    const dairyChip = chips.find((c) => c.label === "Remove dairy");
    expect(dairyChip).toBeDefined();
    expect(dairyChip!.prompt).toContain("dairy");
  });

  it("generates multiple allergen chips for multiple allergens", () => {
    const chips = generateRemixChips(dairyRecipe, {
      allergies: [
        { name: "milk", severity: "moderate" },
        { name: "wheat", severity: "severe" },
      ],
    });

    expect(chips.some((c) => c.label === "Remove dairy")).toBe(true);
    expect(chips.some((c) => c.label === "Remove gluten")).toBe(true);
  });

  it("skips allergen chips when recipe does not contain the allergen", () => {
    const chips = generateRemixChips(veganRecipe, {
      allergies: [{ name: "milk", severity: "moderate" }],
    });

    expect(chips.some((c) => c.label === "Remove dairy")).toBe(false);
  });

  it("generates dietary upgrade chip when user is vegan and recipe is not", () => {
    const chips = generateRemixChips(dairyRecipe, {
      dietType: "vegan",
    });

    expect(chips.some((c) => c.label === "Make vegan")).toBe(true);
  });

  it("skips dietary upgrade when recipe already matches diet", () => {
    const chips = generateRemixChips(veganRecipe, {
      dietType: "vegan",
    });

    expect(chips.some((c) => c.label === "Make vegan")).toBe(false);
  });

  it("generates vegetarian chip when user is vegetarian and recipe is not", () => {
    const meatRecipe = {
      ingredients: [{ name: "beef" }, { name: "onion" }],
      dietTags: [],
    };

    const chips = generateRemixChips(meatRecipe, {
      dietType: "vegetarian",
    });

    expect(chips.some((c) => c.label === "Make vegetarian")).toBe(true);
  });

  it("generates gluten-free chip when recipe has wheat ingredients", () => {
    const chips = generateRemixChips(dairyRecipe, {});

    expect(chips.some((c) => c.label === "Make gluten-free")).toBe(true);
  });

  it("skips gluten-free chip when recipe is already gluten-free", () => {
    const chips = generateRemixChips(veganRecipe, {});

    expect(chips.some((c) => c.label === "Make gluten-free")).toBe(false);
  });

  it("deduplicates gluten chips — no 'Make gluten-free' when 'Remove gluten' exists", () => {
    const chips = generateRemixChips(dairyRecipe, {
      allergies: [{ name: "wheat", severity: "moderate" }],
    });

    const glutenChips = chips.filter(
      (c) => c.label === "Remove gluten" || c.label === "Make gluten-free",
    );
    expect(glutenChips).toHaveLength(1);
    expect(glutenChips[0].label).toBe("Remove gluten");
  });

  it("always includes macro adjustment chips", () => {
    const chips = generateRemixChips(dairyRecipe, {});

    expect(chips.some((c) => c.label === "Lower calorie")).toBe(true);
    expect(chips.some((c) => c.label === "Boost protein")).toBe(true);
  });

  it("caps at 6 chips", () => {
    const chips = generateRemixChips(dairyRecipe, {
      allergies: [
        { name: "milk", severity: "moderate" },
        { name: "wheat", severity: "severe" },
        { name: "eggs", severity: "mild" },
        { name: "soy", severity: "moderate" },
        { name: "peanuts", severity: "severe" },
      ],
      dietType: "vegan",
    });

    expect(chips.length).toBeLessThanOrEqual(6);
  });

  it("handles null/undefined user profile gracefully", () => {
    const chips = generateRemixChips(dairyRecipe, null);

    expect(chips.length).toBeGreaterThan(0);
    expect(chips.some((c) => c.label === "Lower calorie")).toBe(true);
  });

  it("handles empty ingredients", () => {
    const chips = generateRemixChips(
      { ingredients: [], dietTags: [] },
      { allergies: [{ name: "milk", severity: "moderate" }] },
    );

    // No allergen chips for empty ingredients
    expect(chips.some((c) => c.label === "Remove dairy")).toBe(false);
    // Macro chips still present
    expect(chips.some((c) => c.label === "Lower calorie")).toBe(true);
  });
});
