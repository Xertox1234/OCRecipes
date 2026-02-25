import {
  photoIntents,
  photoIntentSchema,
  foodCategories,
  foodCategorySchema,
  PREPARATION_OPTIONS,
  INTENT_CONFIG,
  preparationMethodSchema,
  type PhotoIntent,
  type FoodCategory,
} from "../preparation";

describe("Preparation Constants", () => {
  describe("photoIntentSchema", () => {
    it("accepts all valid intents", () => {
      for (const intent of photoIntents) {
        const result = photoIntentSchema.safeParse(intent);
        expect(result.success).toBe(true);
      }
    });

    it("rejects invalid intent", () => {
      const result = photoIntentSchema.safeParse("invalid");
      expect(result.success).toBe(false);
    });

    it("contains expected intents", () => {
      expect(photoIntents).toContain("log");
      expect(photoIntents).toContain("identify");
      expect(photoIntents).toContain("recipe");
      expect(photoIntents).toContain("calories");
      expect(photoIntents).toContain("menu");
    });
  });

  describe("foodCategorySchema", () => {
    it("accepts all valid categories", () => {
      for (const cat of foodCategories) {
        const result = foodCategorySchema.safeParse(cat);
        expect(result.success).toBe(true);
      }
    });

    it("rejects invalid category", () => {
      const result = foodCategorySchema.safeParse("dessert");
      expect(result.success).toBe(false);
    });

    it("contains expected categories", () => {
      expect(foodCategories).toContain("protein");
      expect(foodCategories).toContain("vegetable");
      expect(foodCategories).toContain("grain");
      expect(foodCategories).toContain("fruit");
      expect(foodCategories).toContain("dairy");
      expect(foodCategories).toContain("beverage");
      expect(foodCategories).toContain("other");
    });
  });

  describe("PREPARATION_OPTIONS", () => {
    it("has options for every food category", () => {
      for (const cat of foodCategories) {
        expect(PREPARATION_OPTIONS[cat]).toBeDefined();
        expect(Array.isArray(PREPARATION_OPTIONS[cat])).toBe(true);
        expect(PREPARATION_OPTIONS[cat].length).toBeGreaterThan(0);
      }
    });

    it('every category includes "As Served" as default', () => {
      for (const cat of foodCategories) {
        expect(PREPARATION_OPTIONS[cat]).toContain("As Served");
      }
    });

    it("protein has cooking methods", () => {
      expect(PREPARATION_OPTIONS.protein).toContain("Grilled");
      expect(PREPARATION_OPTIONS.protein).toContain("Baked");
      expect(PREPARATION_OPTIONS.protein).toContain("Steamed");
    });

    it("vegetable has cooking methods", () => {
      expect(PREPARATION_OPTIONS.vegetable).toContain("Raw");
      expect(PREPARATION_OPTIONS.vegetable).toContain("Steamed");
      expect(PREPARATION_OPTIONS.vegetable).toContain("Roasted");
    });
  });

  describe("INTENT_CONFIG", () => {
    it("has config for every photo intent", () => {
      for (const intent of photoIntents) {
        expect(INTENT_CONFIG[intent]).toBeDefined();
        expect(INTENT_CONFIG[intent].label).toBeTruthy();
      }
    });

    it("log intent needs nutrition and session", () => {
      expect(INTENT_CONFIG.log.needsNutrition).toBe(true);
      expect(INTENT_CONFIG.log.needsSession).toBe(true);
      expect(INTENT_CONFIG.log.canLog).toBe(true);
    });

    it("identify intent does not need nutrition", () => {
      expect(INTENT_CONFIG.identify.needsNutrition).toBe(false);
      expect(INTENT_CONFIG.identify.canLog).toBe(false);
    });

    it("calories intent needs nutrition but not session", () => {
      expect(INTENT_CONFIG.calories.needsNutrition).toBe(true);
      expect(INTENT_CONFIG.calories.needsSession).toBe(false);
    });

    it("menu intent does not need nutrition", () => {
      expect(INTENT_CONFIG.menu.needsNutrition).toBe(false);
      expect(INTENT_CONFIG.menu.canLog).toBe(false);
    });
  });

  describe("preparationMethodSchema", () => {
    it("accepts valid preparation method", () => {
      const result = preparationMethodSchema.safeParse({
        name: "Chicken Breast",
        method: "Grilled",
      });
      expect(result.success).toBe(true);
    });

    it("rejects missing name", () => {
      const result = preparationMethodSchema.safeParse({
        method: "Grilled",
      });
      expect(result.success).toBe(false);
    });

    it("rejects missing method", () => {
      const result = preparationMethodSchema.safeParse({
        name: "Chicken Breast",
      });
      expect(result.success).toBe(false);
    });
  });
});
