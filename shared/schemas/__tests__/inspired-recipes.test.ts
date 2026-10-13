import { describe, it, expect } from "vitest";
import {
  suggestionDraftSchema,
  createListingBodySchema,
  toSuggestion,
} from "../inspired-recipes";

describe("suggestionDraftSchema", () => {
  it("accepts a well-formed draft", () => {
    expect(
      suggestionDraftSchema.safeParse({
        title: "Smoky Black Bean Tacos",
        description:
          "Charred corn tortillas with chipotle beans and lime slaw.",
        totalMinutes: 25,
        tags: ["vegetarian", "quick"],
      }).success,
    ).toBe(true);
  });
  it("rejects an overlong description and out-of-range minutes", () => {
    expect(
      suggestionDraftSchema.safeParse({
        title: "X tacos",
        description: "a".repeat(141),
        totalMinutes: 3,
        tags: [],
      }).success,
    ).toBe(false);
  });
});

describe("createListingBodySchema", () => {
  it("requires a non-empty query", () => {
    expect(createListingBodySchema.safeParse({ query: "  " }).success).toBe(
      false,
    );
    expect(createListingBodySchema.safeParse({ query: "tacos" }).success).toBe(
      true,
    );
  });
});

describe("toSuggestion", () => {
  it("maps a row to the client shape without internal fields", () => {
    const s = toSuggestion({
      id: 7,
      userId: "u1",
      title: "T",
      description: "D long enough",
      totalMinutes: 20,
      tags: ["quick"],
      imageUrl: null,
      makingStartedAt: null,
      madeRecipeId: null,
      createdAt: new Date(),
      expiresAt: new Date(),
    });
    expect(s).toEqual({
      id: 7,
      title: "T",
      description: "D long enough",
      totalMinutes: 20,
      tags: ["quick"],
      imageUrl: null,
      madeRecipeId: null,
    });
    expect(s).not.toHaveProperty("userId");
  });
});
