// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  serializeSteps,
  deserializeSteps,
  formatIngredientText,
  useRecipeForm,
} from "../useRecipeForm";
import type { ImportedRecipeData } from "@shared/types/recipe-import";

vi.mock("@/lib/ingredient-parser", () => ({
  parseIngredientText: (text: string) => {
    // Simple mock: split "2 cups flour" -> { quantity: "2", unit: "cups", name: "flour" }
    const parts = text.trim().split(/\s+/);
    if (parts.length >= 3) {
      return {
        quantity: parts[0],
        unit: parts[1],
        name: parts.slice(2).join(" "),
      };
    }
    return { quantity: "", unit: "", name: text };
  },
}));

describe("serializeSteps", () => {
  it("serializes steps to numbered string", () => {
    expect(serializeSteps(["Preheat oven", "Mix flour", "Bake"])).toBe(
      "1. Preheat oven\n2. Mix flour\n3. Bake",
    );
  });

  it("filters out empty steps", () => {
    expect(serializeSteps(["Preheat oven", "", "  ", "Bake"])).toBe(
      "1. Preheat oven\n2. Bake",
    );
  });

  it("trims step text", () => {
    expect(serializeSteps(["  Preheat oven  "])).toBe("1. Preheat oven");
  });

  it("returns empty string for no valid steps", () => {
    expect(serializeSteps(["", "  "])).toBe("");
  });

  it("handles single step", () => {
    expect(serializeSteps(["Just one step"])).toBe("1. Just one step");
  });
});

describe("deserializeSteps", () => {
  it('parses "1. Step" format', () => {
    expect(deserializeSteps("1. Preheat oven\n2. Mix flour")).toEqual([
      "Preheat oven",
      "Mix flour",
    ]);
  });

  it('parses "1) Step" format', () => {
    expect(deserializeSteps("1) Preheat oven\n2) Mix flour")).toEqual([
      "Preheat oven",
      "Mix flour",
    ]);
  });

  it('parses "Step 1: Step" format', () => {
    expect(deserializeSteps("Step 1: Preheat oven\nStep 2: Mix flour")).toEqual(
      ["Preheat oven", "Mix flour"],
    );
  });

  it("parses bare text (no numbering)", () => {
    expect(deserializeSteps("Preheat oven\nMix flour")).toEqual([
      "Preheat oven",
      "Mix flour",
    ]);
  });

  it("filters empty lines", () => {
    expect(deserializeSteps("1. Preheat\n\n2. Mix")).toEqual([
      "Preheat",
      "Mix",
    ]);
  });

  it("returns empty array for empty string", () => {
    expect(deserializeSteps("")).toEqual([]);
    expect(deserializeSteps("   ")).toEqual([]);
  });

  it("round-trips with serializeSteps", () => {
    const original = ["Preheat oven to 350", "Mix dry ingredients", "Bake"];
    const serialized = serializeSteps(original);
    const deserialized = deserializeSteps(serialized);
    expect(deserialized).toEqual(original);
  });
});

describe("useRecipeForm", () => {
  describe("default state", () => {
    it("initializes with empty defaults", () => {
      const { result } = renderHook(() => useRecipeForm());
      expect(result.current.title).toBe("");
      expect(result.current.description).toBe("");
      expect(result.current.ingredients).toHaveLength(1);
      expect(result.current.ingredients[0].text).toBe("");
      expect(result.current.steps).toHaveLength(1);
      expect(result.current.steps[0].text).toBe("");
      expect(result.current.timeServings.servings).toBe(2);
      expect(result.current.isDirty).toBe(false);
    });

    it("initializes from prefill data", () => {
      const prefill = {
        title: "Test Recipe",
        description: "A description",
        ingredients: [
          { name: "flour", quantity: "2", unit: "cups" },
          { name: "sugar", quantity: "1", unit: "cup" },
        ],
        instructions: ["Mix", "Bake"],
        servings: 4,
        prepTimeMinutes: 10,
        cookTimeMinutes: 30,
        caloriesPerServing: "200",
        proteinPerServing: "10",
        carbsPerServing: "25",
        fatPerServing: "5",
        cuisine: "Italian",
        dietTags: ["Vegetarian"],
        imageUrl: null,
        sourceUrl: "https://example.com/recipe",
      };

      const { result } = renderHook(() => useRecipeForm(prefill));
      expect(result.current.title).toBe("Test Recipe");
      expect(result.current.description).toBe("A description");
      expect(result.current.ingredients).toHaveLength(2);
      expect(result.current.ingredients[0].text).toContain("flour");
      expect(result.current.steps).toHaveLength(2);
      expect(result.current.steps[0].text).toBe("Mix");
      expect(result.current.timeServings.servings).toBe(4);
      expect(result.current.nutrition.calories).toBe("200");
      expect(result.current.tags.cuisine).toBe("Italian");
    });
  });

  describe("ingredient actions", () => {
    it("adds an ingredient", () => {
      const { result } = renderHook(() => useRecipeForm());
      expect(result.current.ingredients).toHaveLength(1);

      act(() => {
        result.current.addIngredient();
      });
      expect(result.current.ingredients).toHaveLength(2);
    });

    it("removes an ingredient", () => {
      const { result } = renderHook(() => useRecipeForm());
      act(() => {
        result.current.addIngredient();
      });
      expect(result.current.ingredients).toHaveLength(2);

      const keyToRemove = result.current.ingredients[0].key;
      act(() => {
        result.current.removeIngredient(keyToRemove);
      });
      expect(result.current.ingredients).toHaveLength(1);
    });

    it("cannot remove the last ingredient", () => {
      const { result } = renderHook(() => useRecipeForm());
      expect(result.current.ingredients).toHaveLength(1);

      const key = result.current.ingredients[0].key;
      act(() => {
        result.current.removeIngredient(key);
      });
      expect(result.current.ingredients).toHaveLength(1);
    });

    it("updates an ingredient", () => {
      const { result } = renderHook(() => useRecipeForm());
      const key = result.current.ingredients[0].key;

      act(() => {
        result.current.updateIngredient(key, "2 cups flour");
      });
      expect(result.current.ingredients[0].text).toBe("2 cups flour");
    });
  });

  describe("step actions", () => {
    it("adds a step", () => {
      const { result } = renderHook(() => useRecipeForm());
      act(() => {
        result.current.addStep();
      });
      expect(result.current.steps).toHaveLength(2);
    });

    it("removes a step", () => {
      const { result } = renderHook(() => useRecipeForm());
      act(() => {
        result.current.addStep();
      });
      const keyToRemove = result.current.steps[0].key;
      act(() => {
        result.current.removeStep(keyToRemove);
      });
      expect(result.current.steps).toHaveLength(1);
    });

    it("cannot remove the last step", () => {
      const { result } = renderHook(() => useRecipeForm());
      const key = result.current.steps[0].key;
      act(() => {
        result.current.removeStep(key);
      });
      expect(result.current.steps).toHaveLength(1);
    });

    it("updates a step", () => {
      const { result } = renderHook(() => useRecipeForm());
      const key = result.current.steps[0].key;
      act(() => {
        result.current.updateStep(key, "Preheat oven");
      });
      expect(result.current.steps[0].text).toBe("Preheat oven");
    });

    it("moves a step down", () => {
      const { result } = renderHook(() => useRecipeForm());
      act(() => {
        result.current.addStep();
      });
      const firstKey = result.current.steps[0].key;
      act(() => {
        result.current.updateStep(firstKey, "First");
        result.current.updateStep(result.current.steps[1].key, "Second");
      });
      act(() => {
        result.current.moveStep(firstKey, "down");
      });
      expect(result.current.steps[0].text).toBe("Second");
      expect(result.current.steps[1].text).toBe("First");
    });

    it("does not move first step up", () => {
      const { result } = renderHook(() => useRecipeForm());
      act(() => {
        result.current.addStep();
      });
      const firstKey = result.current.steps[0].key;
      act(() => {
        result.current.updateStep(firstKey, "First");
      });
      act(() => {
        result.current.moveStep(firstKey, "up");
      });
      // Should not change
      expect(result.current.steps[0].text).toBe("First");
    });

    it("does not move last step down", () => {
      const { result } = renderHook(() => useRecipeForm());
      act(() => {
        result.current.addStep();
      });
      const lastKey = result.current.steps[1].key;
      act(() => {
        result.current.updateStep(lastKey, "Last");
      });
      act(() => {
        result.current.moveStep(lastKey, "down");
      });
      expect(result.current.steps[1].text).toBe("Last");
    });
  });

  describe("summaries", () => {
    it("returns ingredientsSummary when filled", () => {
      const { result } = renderHook(() => useRecipeForm());
      const key = result.current.ingredients[0].key;
      act(() => {
        result.current.updateIngredient(key, "flour");
      });
      expect(result.current.ingredientsSummary).toBe("1 ingredient");
    });

    it("returns undefined ingredientsSummary when empty", () => {
      const { result } = renderHook(() => useRecipeForm());
      expect(result.current.ingredientsSummary).toBeUndefined();
    });

    it("returns instructionsSummary truncated at 40 chars", () => {
      const { result } = renderHook(() => useRecipeForm());
      const key = result.current.steps[0].key;
      const longText =
        "A very long instruction that exceeds forty characters in length";
      act(() => {
        result.current.updateStep(key, longText);
      });
      expect(result.current.instructionsSummary).toContain("Step 1:");
      expect(result.current.instructionsSummary).toContain("...");
    });

    it("returns nutritionSummary when calories set", () => {
      const { result } = renderHook(() => useRecipeForm());
      act(() => {
        result.current.setNutrition({
          calories: "350",
          protein: "20",
          carbs: "",
          fat: "",
        });
      });
      expect(result.current.nutritionSummary).toBe("350 cal · 20g protein");
    });
  });

  describe("isDirty", () => {
    it("is false when empty", () => {
      const { result } = renderHook(() => useRecipeForm());
      expect(result.current.isDirty).toBe(false);
    });

    it("is true after setting title", () => {
      const { result } = renderHook(() => useRecipeForm());
      act(() => {
        result.current.setTitle("My Recipe");
      });
      expect(result.current.isDirty).toBe(true);
    });

    it("is true after changing servings", () => {
      const { result } = renderHook(() => useRecipeForm());
      act(() => {
        result.current.setTimeServings({
          servings: 4,
          prepTime: "",
          cookTime: "",
        });
      });
      expect(result.current.isDirty).toBe(true);
    });
  });

  describe("formToPayload", () => {
    it("serializes form to payload", () => {
      const { result } = renderHook(() => useRecipeForm());

      act(() => {
        result.current.setTitle("My Recipe");
        result.current.updateIngredient(
          result.current.ingredients[0].key,
          "2 cups flour",
        );
        result.current.updateStep(result.current.steps[0].key, "Mix well");
        result.current.setTimeServings({
          servings: 4,
          prepTime: "10",
          cookTime: "30",
        });
        result.current.setNutrition({
          calories: "200",
          protein: "10",
          carbs: "25",
          fat: "5",
        });
        result.current.setTags({
          cuisine: "Italian",
          dietTags: ["Vegetarian"],
        });
      });

      const payload = result.current.formToPayload();
      expect(payload.title).toBe("My Recipe");
      expect(payload.servings).toBe(4);
      expect(payload.prepTimeMinutes).toBe(10);
      expect(payload.cookTimeMinutes).toBe(30);
      expect(payload.cuisine).toBe("Italian");
      expect(payload.dietTags).toEqual(["Vegetarian"]);
      expect(payload.instructions).toEqual(["Mix well"]);
      expect(payload.ingredients).toHaveLength(1);
      expect(payload.ingredients[0].name).toBe("flour");
    });

    it("returns null for empty optional fields", () => {
      const { result } = renderHook(() => useRecipeForm());
      act(() => {
        result.current.setTitle("Minimal");
      });
      const payload = result.current.formToPayload();
      expect(payload.description).toBeNull();
      expect(payload.prepTimeMinutes).toBeNull();
      expect(payload.cookTimeMinutes).toBeNull();
      expect(payload.cuisine).toBeNull();
    });
  });

  describe("prefill round-trip (M10)", () => {
    const basePrefill: ImportedRecipeData = {
      title: "Round Trip",
      description: null,
      servings: 4,
      prepTimeMinutes: null,
      cookTimeMinutes: null,
      cuisine: null,
      dietTags: [],
      ingredients: [
        { name: "olive oil", quantity: "2.5", unit: "tablespoons" },
        { name: "kosher salt", quantity: "1/2", unit: "teaspoon" },
        { name: "garlic", quantity: null, unit: null },
      ],
      instructions: null,
      imageUrl: null,
      caloriesPerServing: null,
      proteinPerServing: null,
      carbsPerServing: null,
      fatPerServing: null,
      sourceUrl: "https://example.com/r",
    };

    it("preserves exact quantity strings (no decimal/fraction normalization)", () => {
      const { result } = renderHook(() => useRecipeForm(basePrefill));
      const payload = result.current.formToPayload();

      expect(payload.ingredients).toHaveLength(3);
      expect(payload.ingredients[0]).toEqual({
        name: "olive oil",
        quantity: "2.5",
        unit: "tablespoons",
      });
      expect(payload.ingredients[1]).toEqual({
        name: "kosher salt",
        quantity: "1/2",
        unit: "teaspoon",
      });
    });

    it("preserves null quantity/unit from prefill (no text-join inference)", () => {
      const { result } = renderHook(() => useRecipeForm(basePrefill));
      const payload = result.current.formToPayload();

      // "garlic" had no quantity/unit — must round-trip as null/null,
      // not be reparsed into { name: "garlic", quantity: null, unit: null }
      // (that part is fine) BUT also not split off leading tokens.
      expect(payload.ingredients[2]).toEqual({
        name: "garlic",
        quantity: null,
        unit: null,
      });
    });

    it("re-parses after user edits an ingredient row (drops snapshot)", () => {
      const { result } = renderHook(() => useRecipeForm(basePrefill));

      const firstKey = result.current.ingredients[0].key;
      act(() => {
        // User edits the row — snapshot must be dropped and text re-parsed.
        result.current.updateIngredient(firstKey, "3 cups water");
      });

      const payload = result.current.formToPayload();
      // With our test mock, "3 cups water" → { quantity: "3", unit: "cups", name: "water" }
      expect(payload.ingredients[0]).toEqual({
        name: "water",
        quantity: "3",
        unit: "cups",
      });
    });

    it("formatIngredientText joins quantity, unit, name with single spaces", () => {
      expect(
        formatIngredientText({
          name: "flour",
          quantity: "2",
          unit: "cups",
        }),
      ).toBe("2 cups flour");
      expect(
        formatIngredientText({ name: "salt", quantity: null, unit: null }),
      ).toBe("salt");
      expect(
        formatIngredientText({ name: "water", quantity: "1", unit: null }),
      ).toBe("1 water");
    });

    it("filters out empty ingredient rows in payload", () => {
      const { result } = renderHook(() => useRecipeForm());
      const key = result.current.ingredients[0].key;
      act(() => {
        result.current.updateIngredient(key, "");
      });
      const payload = result.current.formToPayload();
      expect(payload.ingredients).toHaveLength(0);
    });
  });

  describe("onDirtyChange (L22 — action-fired, not derived)", () => {
    it("fires once when the first edit dirties the form", () => {
      const onDirtyChange = vi.fn();
      const { result } = renderHook(() =>
        useRecipeForm(undefined, { onDirtyChange }),
      );
      expect(onDirtyChange).not.toHaveBeenCalled();
      act(() => {
        result.current.setTitle("My Recipe");
      });
      expect(onDirtyChange).toHaveBeenCalledWith(true);
    });

    it("does not fire again on subsequent edits (no transition)", () => {
      const onDirtyChange = vi.fn();
      const { result } = renderHook(() =>
        useRecipeForm(undefined, { onDirtyChange }),
      );
      act(() => {
        result.current.setTitle("First");
      });
      act(() => {
        result.current.setTitle("Second");
        result.current.setDescription("d");
      });
      // Only the transition false→true should fire.
      expect(onDirtyChange).toHaveBeenCalledTimes(1);
      expect(onDirtyChange).toHaveBeenCalledWith(true);
    });

    it("fires for ingredient/step/tag/nutrition edits too", () => {
      const onDirtyChange = vi.fn();
      const { result } = renderHook(() =>
        useRecipeForm(undefined, { onDirtyChange }),
      );
      act(() => {
        result.current.addIngredient();
      });
      expect(onDirtyChange).toHaveBeenCalledWith(true);
    });

    it("fires true on mount when prefill is supplied (async)", async () => {
      const onDirtyChange = vi.fn();
      const prefill: ImportedRecipeData = {
        title: "Prefilled",
        description: null,
        servings: null,
        prepTimeMinutes: null,
        cookTimeMinutes: null,
        cuisine: null,
        dietTags: [],
        ingredients: [],
        instructions: null,
        imageUrl: null,
        caloriesPerServing: null,
        proteinPerServing: null,
        carbsPerServing: null,
        fatPerServing: null,
        sourceUrl: "https://example.com",
      };
      const { result } = renderHook(() =>
        useRecipeForm(prefill, { onDirtyChange }),
      );
      // Prefill pre-marks dirty.
      expect(result.current.isDirty).toBe(true);
      // The callback fires via queueMicrotask — flush pending microtasks.
      await act(async () => {
        await Promise.resolve();
      });
      expect(onDirtyChange).toHaveBeenCalledWith(true);
    });
  });
});
