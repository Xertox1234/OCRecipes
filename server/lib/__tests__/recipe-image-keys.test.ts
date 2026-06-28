import { describe, it, expect } from "vitest";
import {
  classifyRecipeImageUrl,
  deriveRecipeImageFilename,
} from "../recipe-image-keys";

const BASE = "https://cdn.ocrecipes.app";

describe("classifyRecipeImageUrl", () => {
  it("classifies our R2 recipe images as 'ours'", () => {
    expect(
      classifyRecipeImageUrl(`${BASE}/recipe-images/recipe-abc.png`, BASE),
    ).toBe("ours");
  });
  it("classifies our dev disk recipe images as 'ours'", () => {
    expect(
      classifyRecipeImageUrl("/api/recipe-images/recipe-abc.png", BASE),
    ).toBe("ours");
  });
  it("classifies external photos as 'external'", () => {
    expect(classifyRecipeImageUrl("https://spoonacular.com/x.jpg", BASE)).toBe(
      "external",
    );
  });
  it("classifies null as 'none'", () => {
    expect(classifyRecipeImageUrl(null, BASE)).toBe("none");
  });
  it("does not match avatars (wrong prefix)", () => {
    expect(classifyRecipeImageUrl(`${BASE}/avatars/x.png`, BASE)).toBe(
      "external",
    );
  });
});

describe("deriveRecipeImageFilename", () => {
  it("extracts the filename from an R2 url", () => {
    expect(
      deriveRecipeImageFilename(`${BASE}/recipe-images/recipe-abc.png`),
    ).toBe("recipe-abc.png");
  });
  it("extracts the filename from a disk url", () => {
    expect(deriveRecipeImageFilename("/api/recipe-images/recipe-abc.png")).toBe(
      "recipe-abc.png",
    );
  });
  it("returns null when not a recipe-images url", () => {
    expect(
      deriveRecipeImageFilename("https://spoonacular.com/x.jpg"),
    ).toBeNull();
  });
});
