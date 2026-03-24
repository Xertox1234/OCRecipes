import { describe, it, expect } from "vitest";
import { linking } from "../linking";

describe("linking config", () => {
  it("includes both custom scheme and universal link prefixes", () => {
    expect(linking.prefixes).toContain("ocrecipes://");
    expect(linking.prefixes).toContain("https://ocrecipes.app");
  });

  it("configures FeaturedRecipeDetail path with numeric parse", () => {
    const recipeDetail = linking.config!.screens
      .FeaturedRecipeDetail as unknown as {
      path: string;
      parse: Record<string, (v: string) => number>;
    };

    expect(recipeDetail.path).toBe("recipe/:recipeId");
    expect(recipeDetail.parse.recipeId("42")).toBe(42);
  });

  it("configures Chat path with numeric parse", () => {
    const chat =
      // @ts-expect-error — nested screen config typing is loosely indexed
      linking.config!.screens.Main.screens.CoachTab.screens.Chat;

    expect(chat.path).toBe("chat/:conversationId");
    expect(chat.parse.conversationId("7")).toBe(7);
  });

  it("configures NutritionDetail as a path string", () => {
    expect(linking.config!.screens.NutritionDetail).toBe("nutrition/:barcode");
  });

  it("configures Scan as a path string", () => {
    expect(linking.config!.screens.Scan).toBe("scan");
  });

  it("returns 0 when recipeId parse receives a non-numeric string", () => {
    const recipeDetail = linking.config!.screens
      .FeaturedRecipeDetail as unknown as {
      path: string;
      parse: Record<string, (v: string) => number>;
    };

    expect(recipeDetail.parse.recipeId("abc")).toBe(0);
  });

  it("returns 0 when conversationId parse receives a non-numeric string", () => {
    const chat =
      // @ts-expect-error — nested screen config typing is loosely indexed
      linking.config!.screens.Main.screens.CoachTab.screens.Chat;

    expect(chat.parse.conversationId("abc")).toBe(0);
  });
});
