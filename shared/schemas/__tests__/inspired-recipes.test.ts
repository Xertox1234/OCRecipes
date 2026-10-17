import { describe, it, expect } from "vitest";
import {
  suggestionDraftSchema,
  createListingBodySchema,
  listingResponseSchema,
  toSuggestion,
  SUGGESTION_DESCRIPTION_MAX,
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
  const draft = {
    title: "X tacos",
    description: "Charred corn tortillas with chipotle beans.",
    totalMinutes: 25,
    tags: [],
  };
  it("allows a two-sentence pitch up to 280 characters", () => {
    expect(SUGGESTION_DESCRIPTION_MAX).toBe(280);
    expect(
      suggestionDraftSchema.safeParse({
        ...draft,
        description: "a".repeat(280),
      }).success,
    ).toBe(true);
  });
  it("rejects a description over 280 characters", () => {
    expect(
      suggestionDraftSchema.safeParse({
        ...draft,
        description: "a".repeat(281),
      }).success,
    ).toBe(false);
  });
  it("rejects out-of-range minutes", () => {
    expect(
      suggestionDraftSchema.safeParse({ ...draft, totalMinutes: 3 }).success,
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

describe("listingResponseSchema", () => {
  const card = {
    id: 7,
    title: "Bean Tacos",
    description: "Quick bright tacos tonight.",
    totalMinutes: 20,
    tags: ["quick"],
    imageUrl: null,
    madeRecipeId: null,
  };
  it("accepts a list of well-formed cards, including an empty list", () => {
    expect(
      listingResponseSchema.safeParse({ suggestions: [card] }).success,
    ).toBe(true);
    expect(listingResponseSchema.safeParse({ suggestions: [] }).success).toBe(
      true,
    );
  });
  it("rejects a missing suggestions array", () => {
    expect(listingResponseSchema.safeParse({}).success).toBe(false);
  });
  it("rejects a card with a non-positive id", () => {
    expect(
      listingResponseSchema.safeParse({ suggestions: [{ ...card, id: 0 }] })
        .success,
    ).toBe(false);
  });
  it("rejects a card missing imageUrl or madeRecipeId", () => {
    const { imageUrl: _i, ...noImage } = card;
    const { madeRecipeId: _m, ...noMade } = card;
    expect(
      listingResponseSchema.safeParse({ suggestions: [noImage] }).success,
    ).toBe(false);
    expect(
      listingResponseSchema.safeParse({ suggestions: [noMade] }).success,
    ).toBe(false);
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
