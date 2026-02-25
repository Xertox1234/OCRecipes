import {
  createSavedItemSchema,
  savedItemTypeSchema,
} from "../saved-items";

describe("Saved Items Schemas", () => {
  describe("savedItemTypeSchema", () => {
    it("accepts valid saved item types", () => {
      // Read the valid types from the schema
      const result = savedItemTypeSchema.safeParse("recipe");
      expect(result.success).toBe(true);
    });

    it("rejects invalid type", () => {
      const result = savedItemTypeSchema.safeParse("invalid_type");
      expect(result.success).toBe(false);
    });
  });

  describe("createSavedItemSchema", () => {
    it("accepts valid saved item with required fields", () => {
      const result = createSavedItemSchema.safeParse({
        type: "recipe",
        title: "My Favorite Recipe",
      });
      expect(result.success).toBe(true);
    });

    it("accepts all optional fields", () => {
      const result = createSavedItemSchema.safeParse({
        type: "recipe",
        title: "My Favorite Recipe",
        description: "A delicious recipe",
        difficulty: "Easy",
        timeEstimate: "30 minutes",
        instructions: "Step 1: Cook. Step 2: Eat.",
        sourceItemId: 42,
        sourceProductName: "Chicken Breast",
      });
      expect(result.success).toBe(true);
    });

    it("rejects empty title", () => {
      const result = createSavedItemSchema.safeParse({
        type: "recipe",
        title: "",
      });
      expect(result.success).toBe(false);
    });

    it("rejects title longer than 200 chars", () => {
      const result = createSavedItemSchema.safeParse({
        type: "recipe",
        title: "a".repeat(201),
      });
      expect(result.success).toBe(false);
    });

    it("rejects description longer than 2000 chars", () => {
      const result = createSavedItemSchema.safeParse({
        type: "recipe",
        title: "Valid Title",
        description: "a".repeat(2001),
      });
      expect(result.success).toBe(false);
    });

    it("rejects instructions longer than 10000 chars", () => {
      const result = createSavedItemSchema.safeParse({
        type: "recipe",
        title: "Valid Title",
        instructions: "a".repeat(10001),
      });
      expect(result.success).toBe(false);
    });

    it("rejects non-positive sourceItemId", () => {
      const result = createSavedItemSchema.safeParse({
        type: "recipe",
        title: "Valid Title",
        sourceItemId: 0,
      });
      expect(result.success).toBe(false);
    });

    it("rejects negative sourceItemId", () => {
      const result = createSavedItemSchema.safeParse({
        type: "recipe",
        title: "Valid Title",
        sourceItemId: -1,
      });
      expect(result.success).toBe(false);
    });

    it("rejects missing type", () => {
      const result = createSavedItemSchema.safeParse({
        title: "Valid Title",
      });
      expect(result.success).toBe(false);
    });

    it("rejects missing title", () => {
      const result = createSavedItemSchema.safeParse({
        type: "recipe",
      });
      expect(result.success).toBe(false);
    });
  });
});
