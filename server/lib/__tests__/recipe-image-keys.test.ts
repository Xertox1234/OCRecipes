import { describe, it, expect } from "vitest";
import {
  classifyRecipeImageUrl,
  deriveRecipeImageFilename,
  bustImageUrl,
} from "../recipe-image-keys";

const BASE = "https://cdn.ocrecipes.com";

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
  it("still classifies a cache-busted (?v=) url as 'ours'", () => {
    expect(
      classifyRecipeImageUrl(`${BASE}/recipe-images/recipe-abc.png?v=7`, BASE),
    ).toBe("ours");
  });
  it("classifies a .jpg recipe image as 'ours' — classification is by path prefix, not extension", () => {
    expect(
      classifyRecipeImageUrl(`${BASE}/recipe-images/recipe-abc.jpg`, BASE),
    ).toBe("ours");
    expect(
      classifyRecipeImageUrl("/api/recipe-images/recipe-abc.jpg", BASE),
    ).toBe("ours");
  });

  // Security audit 2026-11-12, L11: "ours" means exactly the shape we store,
  // <base>/recipe-images/<one filename>. A URL that only starts that way is a
  // stranger's string and is treated like any other site's.
  it.each([
    ["a parent step", `${BASE}/recipe-images/../avatars/victim.jpg`],
    ["a nested path", `${BASE}/recipe-images/a/b.jpg`],
    [
      "an encoded parent step",
      `${BASE}/recipe-images/%2e%2e%2favatars%2fv.jpg`,
    ],
    ["a fragment", `${BASE}/recipe-images/recipe-abc.jpg#x`],
    ["no filename", `${BASE}/recipe-images/`],
    ["a dots-only filename", `${BASE}/recipe-images/..`],
    [
      "a parent step on the dev disk path",
      "/api/recipe-images/../avatars/v.jpg",
    ],
    [
      "a parent step hidden behind a query",
      `${BASE}/recipe-images/../x.jpg?v=1`,
    ],
  ])("classifies a url with %s as 'external'", (_label, url) => {
    expect(classifyRecipeImageUrl(url, BASE)).toBe("external");
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
  it("strips a cache-busting query string before extracting", () => {
    expect(
      deriveRecipeImageFilename(`${BASE}/recipe-images/recipe-abc.png?v=7`),
    ).toBe("recipe-abc.png");
  });
  it("extracts a .jpg filename — the character class has no extension assumption", () => {
    expect(
      deriveRecipeImageFilename(`${BASE}/recipe-images/recipe-abc.jpg`),
    ).toBe("recipe-abc.jpg");
  });
});

describe("bustImageUrl", () => {
  it("appends a ?v= token to a clean url", () => {
    expect(bustImageUrl(`${BASE}/recipe-images/recipe-abc.png`, 7)).toBe(
      `${BASE}/recipe-images/recipe-abc.png?v=7`,
    );
  });
  it("replaces an existing ?v= token (does not stack)", () => {
    expect(bustImageUrl(`${BASE}/recipe-images/recipe-abc.png?v=1`, 2)).toBe(
      `${BASE}/recipe-images/recipe-abc.png?v=2`,
    );
  });
});
