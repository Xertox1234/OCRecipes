import {
  allergySchema,
  insertUserSchema,
  insertScannedItemSchema,
  insertDailyLogSchema,
  insertUserProfileSchema,
} from "../schema";

describe("Schema Validation", () => {
  describe("allergySchema", () => {
    it("validates valid allergy with mild severity", () => {
      const allergy = { name: "Peanuts", severity: "mild" };
      const result = allergySchema.safeParse(allergy);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(allergy);
      }
    });

    it("validates valid allergy with moderate severity", () => {
      const allergy = { name: "Shellfish", severity: "moderate" };
      const result = allergySchema.safeParse(allergy);
      expect(result.success).toBe(true);
    });

    it("validates valid allergy with severe severity", () => {
      const allergy = { name: "Tree Nuts", severity: "severe" };
      const result = allergySchema.safeParse(allergy);
      expect(result.success).toBe(true);
    });

    it("rejects invalid severity value", () => {
      const allergy = { name: "Eggs", severity: "critical" };
      const result = allergySchema.safeParse(allergy);
      expect(result.success).toBe(false);
    });

    it("rejects missing name", () => {
      const allergy = { severity: "mild" };
      const result = allergySchema.safeParse(allergy);
      expect(result.success).toBe(false);
    });

    it("rejects missing severity", () => {
      const allergy = { name: "Milk" };
      const result = allergySchema.safeParse(allergy);
      expect(result.success).toBe(false);
    });

    it("rejects empty object", () => {
      const result = allergySchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe("insertUserSchema", () => {
    it("validates valid user with username and password", () => {
      const user = {
        username: "testuser",
        email: "testuser@example.com",
        password: "securepass123",
      };
      const result = insertUserSchema.safeParse(user);
      expect(result.success).toBe(true);
    });

    it("rejects missing username", () => {
      const user = { password: "securepass123" };
      const result = insertUserSchema.safeParse(user);
      expect(result.success).toBe(false);
    });

    it("rejects missing password", () => {
      const user = { username: "testuser" };
      const result = insertUserSchema.safeParse(user);
      expect(result.success).toBe(false);
    });

    it("strips extra fields not in schema", () => {
      const user = {
        username: "testuser",
        email: "testuser@example.com",
        password: "securepass123",
        displayName: "Test User",
      };
      const result = insertUserSchema.safeParse(user);
      expect(result.success).toBe(true);
      // displayName is stripped — schema picks only username, email, and password
      if (result.success) {
        expect(result.data).toEqual({
          username: "testuser",
          email: "testuser@example.com",
          password: "securepass123",
        });
      }
    });
  });

  describe("insertScannedItemSchema", () => {
    it("validates valid scanned item with required fields", () => {
      const item = {
        userId: "user-123",
        productName: "Apple",
      };
      const result = insertScannedItemSchema.safeParse(item);
      expect(result.success).toBe(true);
    });

    it("validates scanned item with all optional fields", () => {
      const item = {
        userId: "user-123",
        productName: "Granola Bar",
        barcode: "012345678901",
        brandName: "Nature Valley",
        servingSize: "1 bar (42g)",
        calories: "190",
        protein: "4",
        carbs: "29",
        fat: "6",
        fiber: "2",
        sugar: "12",
        sodium: "180",
        imageUrl: "https://example.com/image.jpg",
      };
      const result = insertScannedItemSchema.safeParse(item);
      expect(result.success).toBe(true);
    });

    it("rejects missing userId", () => {
      const item = { productName: "Apple" };
      const result = insertScannedItemSchema.safeParse(item);
      expect(result.success).toBe(false);
    });

    it("rejects missing productName", () => {
      const item = { userId: "user-123" };
      const result = insertScannedItemSchema.safeParse(item);
      expect(result.success).toBe(false);
    });
  });

  describe("insertDailyLogSchema", () => {
    it("validates valid daily log with required fields", () => {
      const log = {
        userId: "user-123",
        scannedItemId: 1,
      };
      const result = insertDailyLogSchema.safeParse(log);
      expect(result.success).toBe(true);
    });

    it("validates daily log with optional servings and mealType", () => {
      const log = {
        userId: "user-123",
        scannedItemId: 1,
        servings: "2.5",
        mealType: "breakfast",
      };
      const result = insertDailyLogSchema.safeParse(log);
      expect(result.success).toBe(true);
    });

    it("rejects missing userId", () => {
      const log = { scannedItemId: 1 };
      const result = insertDailyLogSchema.safeParse(log);
      expect(result.success).toBe(false);
    });

    it("accepts missing scannedItemId (nullable for meal plan confirmations)", () => {
      const log = { userId: "user-123" };
      const result = insertDailyLogSchema.safeParse(log);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.scannedItemId).toBeUndefined();
      }
    });

    it("accepts explicit null scannedItemId with source and recipeId", () => {
      const log = {
        userId: "user-123",
        scannedItemId: null,
        recipeId: 42,
        source: "meal_plan_confirm",
      };
      const result = insertDailyLogSchema.safeParse(log);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.scannedItemId).toBeNull();
        expect(result.data.recipeId).toBe(42);
        expect(result.data.source).toBe("meal_plan_confirm");
      }
    });
  });

  describe("insertUserProfileSchema", () => {
    it("validates valid profile with required userId", () => {
      const profile = { userId: "user-123" };
      const result = insertUserProfileSchema.safeParse(profile);
      expect(result.success).toBe(true);
    });

    it("validates profile with dietary preferences", () => {
      const profile = {
        userId: "user-123",
        dietType: "vegetarian",
        activityLevel: "moderate",
        householdSize: 4,
        cookingSkillLevel: "intermediate",
        cookingTimeAvailable: "30-60 min",
        primaryGoal: "weight loss",
      };
      const result = insertUserProfileSchema.safeParse(profile);
      expect(result.success).toBe(true);
    });

    it("validates profile with allergies array", () => {
      const profile = {
        userId: "user-123",
        allergies: [
          { name: "Peanuts", severity: "severe" },
          { name: "Shellfish", severity: "moderate" },
        ],
      };
      const result = insertUserProfileSchema.safeParse(profile);
      expect(result.success).toBe(true);
    });

    it("validates profile with array fields", () => {
      const profile = {
        userId: "user-123",
        healthConditions: ["diabetes", "high blood pressure"],
        foodDislikes: ["olives", "anchovies"],
        cuisinePreferences: ["Italian", "Mexican", "Japanese"],
      };
      const result = insertUserProfileSchema.safeParse(profile);
      expect(result.success).toBe(true);
    });

    it("rejects missing userId", () => {
      const profile = { dietType: "vegan" };
      const result = insertUserProfileSchema.safeParse(profile);
      expect(result.success).toBe(false);
    });
  });
});
