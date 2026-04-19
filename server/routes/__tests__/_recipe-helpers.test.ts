import { describe, it, expect } from "vitest";
import { stripAuthorId, stripAuthorIdOne } from "../_recipe-helpers";

describe("stripAuthorId", () => {
  it("removes authorId from each recipe in the array", () => {
    const recipes = [
      { id: 1, title: "Pasta", authorId: "user-1" },
      { id: 2, title: "Salad", authorId: "user-2" },
    ];

    const result = stripAuthorId(recipes);

    expect(result).toEqual([
      { id: 1, title: "Pasta" },
      { id: 2, title: "Salad" },
    ]);
    for (const r of result) {
      expect(r).not.toHaveProperty("authorId");
    }
  });

  it("returns empty array unchanged", () => {
    expect(stripAuthorId([])).toEqual([]);
  });

  it("handles recipes without authorId value (undefined)", () => {
    const recipes = [{ id: 1, title: "No Author", authorId: undefined }];

    const result = stripAuthorId(recipes);

    expect(result).toEqual([{ id: 1, title: "No Author" }]);
  });

  it("preserves all other fields", () => {
    const recipe = {
      id: 42,
      title: "Test",
      authorId: "user-99",
      description: "desc",
      calories: 300,
    };

    const [result] = stripAuthorId([recipe]);

    expect(result).toEqual({
      id: 42,
      title: "Test",
      description: "desc",
      calories: 300,
    });
  });
});

describe("stripAuthorIdOne", () => {
  it("removes authorId from a single recipe", () => {
    const recipe = { id: 1, title: "Soup", authorId: "user-5" };

    const result = stripAuthorIdOne(recipe);

    expect(result).toEqual({ id: 1, title: "Soup" });
    expect(result).not.toHaveProperty("authorId");
  });

  it("preserves all other fields on a single recipe", () => {
    const recipe = {
      id: 7,
      title: "Steak",
      authorId: "user-3",
      servings: 2,
    };

    const result = stripAuthorIdOne(recipe);

    expect(result).toEqual({ id: 7, title: "Steak", servings: 2 });
  });
});
