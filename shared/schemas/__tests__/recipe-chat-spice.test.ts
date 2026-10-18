import { describe, it, expect } from "vitest";
import { recipeChatMetadataSchema } from "../recipe-chat";

function metadata(recipeExtra: Record<string, unknown>) {
  return {
    metadataVersion: 1,
    recipe: {
      title: "Curry",
      description: "Warm.",
      difficulty: "Easy",
      timeEstimate: "30 min",
      servings: 2,
      ingredients: [{ name: "chili", quantity: "1", unit: "" }],
      instructions: ["Cook"],
      dietTags: [],
      ...recipeExtra,
    },
    allergenWarning: null,
    imageUrl: null,
  };
}

describe("recipeChatMetadataSchema spiceLevel", () => {
  it("still parses old metadata without the field", () => {
    const parsed = recipeChatMetadataSchema.safeParse(metadata({}));
    expect(parsed.success).toBe(true);
    expect(parsed.data?.recipe.spiceLevel ?? null).toBeNull();
  });

  it("keeps a valid level", () => {
    const parsed = recipeChatMetadataSchema.parse(
      metadata({ spiceLevel: "medium" }),
    );
    expect(parsed.recipe.spiceLevel).toBe("medium");
  });

  it("turns an invalid level into null instead of rejecting the recipe", () => {
    const parsed = recipeChatMetadataSchema.safeParse(
      metadata({ spiceLevel: "volcanic" }),
    );
    expect(parsed.success).toBe(true);
    expect(parsed.data?.recipe.spiceLevel).toBeNull();
  });
});
