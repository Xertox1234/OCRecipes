import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import type { InspiredSuggestionRow } from "@shared/schema";
import type { Suggestion } from "@shared/schemas/inspired-recipes";

import { storage } from "../../storage";
import { createSuggestionListing } from "../../services/inspired-recipes";
import {
  generateFullRecipe,
  generateAndPatchRecipeImage,
} from "../../services/recipe-generation";
import { createMockCommunityRecipe } from "../../__tests__/factories";
import { register } from "../inspired-recipes";
import { expectResponseToMatch } from "../../../test/utils/expect-response-schema";
import {
  listingResponseSchema,
  makeResponseSchema,
} from "@shared/schemas/inspired-recipes";

vi.mock("../../middleware/auth");
vi.mock("express-rate-limit");
vi.mock("../../services/inspired-recipes", () => ({
  createSuggestionListing: vi.fn(),
}));
vi.mock("../../services/recipe-generation", () => ({
  generateFullRecipe: vi.fn(),
  generateAndPatchRecipeImage: vi.fn(() => Promise.resolve()),
  normalizeProductName: vi.fn((name: string) => name.toLowerCase()),
}));
vi.mock("../../storage", () => ({
  storage: {
    getEffectiveTierForUser: vi.fn(),
    getUserVerificationStats: vi.fn(),
    getUserProfile: vi.fn(),
    countInspiredSuggestionsSince: vi.fn(),
    getInspiredSuggestions: vi.fn(),
    getInspiredSuggestion: vi.fn(),
    startMakingSuggestion: vi.fn(),
    abandonMakingSuggestion: vi.fn(),
    claimInspiredSuggestionMade: vi.fn(),
    getDailyRecipeGenerationCount: vi.fn(),
    createRecipeWithLimitCheck: vi.fn(),
    getCommunityRecipe: vi.fn(),
    saveRecipeToSavedItems: vi.fn(),
    deleteCommunityRecipe: vi.fn(),
  },
}));

const card: Suggestion = {
  id: 5,
  title: "Bean Tacos",
  description: "Quick bright tacos tonight.",
  totalMinutes: 20,
  tags: ["quick"],
  imageUrl: null,
  madeRecipeId: null,
};

const row = (
  over: Partial<InspiredSuggestionRow> = {},
): InspiredSuggestionRow => ({
  ...card,
  userId: "1",
  makingStartedAt: null,
  createdAt: new Date(),
  expiresAt: new Date(Date.now() + 3600_000),
  ...over,
});

const generated = {
  title: "Bean Tacos",
  description: "d",
  difficulty: "Easy",
  timeEstimate: "20 min",
  ingredients: [{ name: "beans", quantity: "1", unit: "can" }],
  instructions: ["Cook."],
  dietTags: [],
  imageUrl: null,
};

const token = new Date("2026-10-12T12:00:00Z");

function app() {
  const a = express();
  a.use(express.json());
  register(a);
  return a;
}

const auth = { Authorization: "Bearer t" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(storage.getEffectiveTierForUser).mockResolvedValue("premium");
  vi.mocked(storage.getUserVerificationStats).mockResolvedValue({
    count: 0,
    frontLabelCount: 0,
    compositeScore: 0,
    streak: 0,
  });
  vi.mocked(storage.getUserProfile).mockResolvedValue(undefined);
  vi.mocked(storage.countInspiredSuggestionsSince).mockResolvedValue(0);
  vi.mocked(storage.getDailyRecipeGenerationCount).mockResolvedValue(0);
  vi.mocked(storage.startMakingSuggestion).mockResolvedValue(token);
  vi.mocked(storage.abandonMakingSuggestion).mockResolvedValue(undefined);
  vi.mocked(storage.saveRecipeToSavedItems).mockResolvedValue("linked");
  vi.mocked(storage.deleteCommunityRecipe).mockResolvedValue(true);
});

describe("POST /api/inspired/suggestions", () => {
  it("returns cards", async () => {
    vi.mocked(createSuggestionListing).mockResolvedValue([card]);
    const res = await request(app())
      .post("/api/inspired/suggestions")
      .set(auth)
      .send({ query: "tacos" });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ suggestions: [card] });
    expectResponseToMatch(res.body, listingResponseSchema);
    expect(vi.mocked(createSuggestionListing).mock.calls[0][0]).toMatchObject({
      userId: "1",
      request: "tacos",
      count: 8,
      useSpoonacular: true,
    });
  });
  it("is premium-gated", async () => {
    vi.mocked(storage.getEffectiveTierForUser).mockResolvedValue("free");
    const res = await request(app())
      .post("/api/inspired/suggestions")
      .set(auth)
      .send({ query: "tacos" });
    expect(res.status).toBe(403);
    expect(createSuggestionListing).not.toHaveBeenCalled();
  });
  it("429s at the daily card cap without calling the AI", async () => {
    vi.mocked(storage.countInspiredSuggestionsSince).mockResolvedValue(80);
    const res = await request(app())
      .post("/api/inspired/suggestions")
      .set(auth)
      .send({ query: "tacos" });
    expect(res.status).toBe(429);
    expect(res.body.code).toBe("DAILY_LIMIT_REACHED");
    expect(res.body.error).toBe(
      "You've reached today's limit for recipe ideas.",
    );
    expect(createSuggestionListing).not.toHaveBeenCalled();
  });
  it("400s on a bad body", async () => {
    const res = await request(app())
      .post("/api/inspired/suggestions")
      .set(auth)
      .send({});
    expect(res.status).toBe(400);
  });
  it("502s when no listing could be made", async () => {
    vi.mocked(createSuggestionListing).mockResolvedValue(null);
    const res = await request(app())
      .post("/api/inspired/suggestions")
      .set(auth)
      .send({ query: "tacos" });
    expect(res.status).toBe(502);
    expect(res.body.code).toBe("AI_UNAVAILABLE");
  });
});

describe("GET /api/inspired/suggestions", () => {
  it("returns only the caller's rows, without userId or any Spoonacular field", async () => {
    vi.mocked(storage.getInspiredSuggestions).mockResolvedValue([row()]);
    const res = await request(app())
      .get("/api/inspired/suggestions?ids=5,6")
      .set(auth);
    expect(res.status).toBe(200);
    expect(vi.mocked(storage.getInspiredSuggestions)).toHaveBeenCalledWith(
      "1",
      [5, 6],
    );
    expect(res.body.suggestions[0]).toEqual(card);
    expectResponseToMatch(res.body, listingResponseSchema);
    expect(JSON.stringify(res.body)).not.toMatch(/userId|spoonacular/i);
  });
  it("400s on bad ids", async () => {
    const res = await request(app())
      .get("/api/inspired/suggestions?ids=abc")
      .set(auth);
    expect(res.status).toBe(400);
  });
  it("400s on an id beyond int4", async () => {
    const res = await request(app())
      .get("/api/inspired/suggestions?ids=99999999999")
      .set(auth);
    expect(res.status).toBe(400);
  });
  it("400s on more than 20 ids", async () => {
    const ids = Array.from({ length: 21 }, (_, i) => i + 1).join(",");
    const res = await request(app())
      .get(`/api/inspired/suggestions?ids=${ids}`)
      .set(auth);
    expect(res.status).toBe(400);
  });
});

describe("POST /api/inspired/suggestions/:id/make", () => {
  const make = () =>
    request(app()).post("/api/inspired/suggestions/5/make").set(auth);

  it("404s for someone else's (or missing) suggestion", async () => {
    vi.mocked(storage.getInspiredSuggestion).mockResolvedValue(undefined);
    const res = await make();
    expect(res.status).toBe(404);
    expect(storage.getInspiredSuggestion).toHaveBeenCalledWith("1", 5);
    expect(generateFullRecipe).not.toHaveBeenCalled();
  });
  it("returns the existing recipe when already made", async () => {
    vi.mocked(storage.getInspiredSuggestion).mockResolvedValue(
      row({ madeRecipeId: 77 }),
    );
    const res = await make();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ recipeId: 77 });
    expectResponseToMatch(res.body, makeResponseSchema);
    expect(generateFullRecipe).not.toHaveBeenCalled();
  });
  it("adds an already-made recipe to Saved items (backfills older makes)", async () => {
    vi.mocked(storage.getInspiredSuggestion).mockResolvedValue(
      row({ madeRecipeId: 77 }),
    );
    vi.mocked(storage.getCommunityRecipe).mockResolvedValue(
      createMockCommunityRecipe({ id: 77, title: "Smoky Bean Tacos" }),
    );
    const res = await make();
    expect(res.status).toBe(200);
    expect(storage.getCommunityRecipe).toHaveBeenCalledWith(77, "1");
    expect(storage.saveRecipeToSavedItems).toHaveBeenCalledWith(
      "1",
      expect.objectContaining({
        recipeId: 77,
        recipeType: "community",
        title: "Smoky Bean Tacos",
      }),
    );
  });
  it("skips Saved items when the already-made recipe is gone", async () => {
    vi.mocked(storage.getInspiredSuggestion).mockResolvedValue(
      row({ madeRecipeId: 77 }),
    );
    vi.mocked(storage.getCommunityRecipe).mockResolvedValue(undefined);
    const res = await make();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ recipeId: 77 });
    expect(storage.saveRecipeToSavedItems).not.toHaveBeenCalled();
  });
  it("still returns an already-made recipe when its lookup fails", async () => {
    vi.mocked(storage.getInspiredSuggestion).mockResolvedValue(
      row({ madeRecipeId: 77 }),
    );
    vi.mocked(storage.getCommunityRecipe).mockRejectedValue(
      new Error("db down"),
    );
    const res = await make();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ recipeId: 77 });
    expect(storage.saveRecipeToSavedItems).not.toHaveBeenCalled();
  });
  it("adds a newly made recipe to Saved items", async () => {
    vi.mocked(storage.getInspiredSuggestion).mockResolvedValue(row());
    vi.mocked(generateFullRecipe).mockResolvedValue(generated);
    vi.mocked(storage.createRecipeWithLimitCheck).mockResolvedValue(
      createMockCommunityRecipe({ id: 88, title: "Bean Tacos" }),
    );
    vi.mocked(storage.claimInspiredSuggestionMade).mockResolvedValue(true);
    const res = await make();
    expect(res.status).toBe(201);
    expect(storage.saveRecipeToSavedItems).toHaveBeenCalledWith(
      "1",
      expect.objectContaining({
        recipeId: 88,
        recipeType: "community",
        title: "Bean Tacos",
      }),
    );
  });
  it("still returns the made recipe when adding to Saved items fails", async () => {
    vi.mocked(storage.getInspiredSuggestion).mockResolvedValue(row());
    vi.mocked(generateFullRecipe).mockResolvedValue(generated);
    vi.mocked(storage.createRecipeWithLimitCheck).mockResolvedValue(
      createMockCommunityRecipe({ id: 88, title: "Bean Tacos" }),
    );
    vi.mocked(storage.claimInspiredSuggestionMade).mockResolvedValue(true);
    vi.mocked(storage.saveRecipeToSavedItems).mockRejectedValue(
      new Error("db down"),
    );
    const res = await make();
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ recipeId: 88 });
    expect(storage.abandonMakingSuggestion).not.toHaveBeenCalled();
  });
  it("410s when expired", async () => {
    vi.mocked(storage.getInspiredSuggestion).mockResolvedValue(
      row({ expiresAt: new Date(Date.now() - 1) }),
    );
    const res = await make();
    expect(res.status).toBe(410);
    expect(res.body.code).toBe("SUGGESTION_EXPIRED");
  });
  it("creates a private recipe with its own photo and claims the card", async () => {
    vi.mocked(storage.getInspiredSuggestion).mockResolvedValue(
      row({ imageUrl: "https://img/card.jpg" }),
    );
    vi.mocked(generateFullRecipe).mockResolvedValue(generated);
    vi.mocked(storage.createRecipeWithLimitCheck).mockResolvedValue(
      createMockCommunityRecipe({ id: 88, title: "Bean Tacos" }),
    );
    vi.mocked(storage.claimInspiredSuggestionMade).mockResolvedValue(true);
    const res = await make();
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ recipeId: 88 });
    expectResponseToMatch(res.body, makeResponseSchema);
    const data = vi.mocked(storage.createRecipeWithLimitCheck).mock.calls[0][2];
    expect(data).toMatchObject({
      authorId: "1",
      isPublic: false,
      imageUrl: null,
    });
    expect(storage.claimInspiredSuggestionMade).toHaveBeenCalledWith(
      "1",
      5,
      88,
    );
    expect(generateAndPatchRecipeImage).toHaveBeenCalledWith(
      88,
      expect.objectContaining({ title: "Bean Tacos" }),
    );
    expect(storage.abandonMakingSuggestion).not.toHaveBeenCalled();
  });
  it("409s when another tap is already making it, and never generates twice", async () => {
    vi.mocked(storage.getInspiredSuggestion).mockResolvedValue(row());
    vi.mocked(storage.startMakingSuggestion).mockResolvedValue(null);
    const res = await make();
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("MAKING_IN_PROGRESS");
    expect(generateFullRecipe).not.toHaveBeenCalled();
    expect(storage.abandonMakingSuggestion).not.toHaveBeenCalled();
  });
  it("releases the making lock when generation fails", async () => {
    vi.mocked(storage.getInspiredSuggestion).mockResolvedValue(row());
    vi.mocked(generateFullRecipe).mockRejectedValue(new Error("ai down"));
    const res = await make();
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(storage.abandonMakingSuggestion).toHaveBeenCalledWith(5, token);
  });
  it("releases the making lock when the recipe insert throws", async () => {
    vi.mocked(storage.getInspiredSuggestion).mockResolvedValue(row());
    vi.mocked(generateFullRecipe).mockResolvedValue(generated);
    vi.mocked(storage.createRecipeWithLimitCheck).mockRejectedValue(
      new Error("db down"),
    );
    const res = await make();
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(storage.abandonMakingSuggestion).toHaveBeenCalledWith(5, token);
  });
  it("releases the making lock when createRecipeWithLimitCheck returns null", async () => {
    vi.mocked(storage.getInspiredSuggestion).mockResolvedValue(row());
    vi.mocked(generateFullRecipe).mockResolvedValue(generated);
    vi.mocked(storage.createRecipeWithLimitCheck).mockResolvedValue(null);
    const res = await make();
    expect(res.status).toBe(429);
    expect(storage.abandonMakingSuggestion).toHaveBeenCalledWith(5, token);
  });
  it("403s on the make route's premium gate before any lookup or AI call", async () => {
    vi.mocked(storage.getEffectiveTierForUser).mockResolvedValue("free");
    const res = await make();
    expect(res.status).toBe(403);
    expect(storage.getInspiredSuggestion).not.toHaveBeenCalled();
    expect(storage.startMakingSuggestion).not.toHaveBeenCalled();
    expect(generateFullRecipe).not.toHaveBeenCalled();
  });
  it("on a lost claim returns the winner's recipe and deletes the duplicate", async () => {
    vi.mocked(storage.getInspiredSuggestion)
      .mockResolvedValueOnce(row())
      .mockResolvedValueOnce(row({ madeRecipeId: 77 }));
    vi.mocked(generateFullRecipe).mockResolvedValue(generated);
    vi.mocked(storage.createRecipeWithLimitCheck).mockResolvedValue(
      createMockCommunityRecipe({ id: 88, title: "Bean Tacos" }),
    );
    vi.mocked(storage.claimInspiredSuggestionMade).mockResolvedValue(false);
    const res = await make();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ recipeId: 77 });
    expect(storage.deleteCommunityRecipe).toHaveBeenCalledWith(88, "1");
    expect(generateAndPatchRecipeImage).not.toHaveBeenCalled();
    expect(storage.abandonMakingSuggestion).not.toHaveBeenCalled();
  });
  it("keeps its own recipe on a lost claim when no winner recipe is found", async () => {
    vi.mocked(storage.getInspiredSuggestion)
      .mockResolvedValueOnce(row())
      .mockResolvedValueOnce(undefined);
    vi.mocked(generateFullRecipe).mockResolvedValue(generated);
    vi.mocked(storage.createRecipeWithLimitCheck).mockResolvedValue(
      createMockCommunityRecipe({ id: 88, title: "Bean Tacos" }),
    );
    vi.mocked(storage.claimInspiredSuggestionMade).mockResolvedValue(false);
    const res = await make();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ recipeId: 88 });
    expect(storage.deleteCommunityRecipe).not.toHaveBeenCalled();
    expect(generateAndPatchRecipeImage).not.toHaveBeenCalled();
  });
  it("still answers with the winner when deleting the duplicate fails", async () => {
    vi.mocked(storage.getInspiredSuggestion)
      .mockResolvedValueOnce(row())
      .mockResolvedValueOnce(row({ madeRecipeId: 77 }));
    vi.mocked(generateFullRecipe).mockResolvedValue(generated);
    vi.mocked(storage.createRecipeWithLimitCheck).mockResolvedValue(
      createMockCommunityRecipe({ id: 88, title: "Bean Tacos" }),
    );
    vi.mocked(storage.claimInspiredSuggestionMade).mockResolvedValue(false);
    vi.mocked(storage.deleteCommunityRecipe).mockRejectedValue(new Error("db"));
    const res = await make();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ recipeId: 77 });
  });
  it("deletes the new recipe and releases the lock when the claim throws", async () => {
    vi.mocked(storage.getInspiredSuggestion).mockResolvedValue(row());
    vi.mocked(generateFullRecipe).mockResolvedValue(generated);
    vi.mocked(storage.createRecipeWithLimitCheck).mockResolvedValue(
      createMockCommunityRecipe({ id: 88, title: "Bean Tacos" }),
    );
    vi.mocked(storage.claimInspiredSuggestionMade).mockRejectedValue(
      new Error("db down"),
    );
    const res = await make();
    expect(res.status).toBe(500);
    expect(storage.deleteCommunityRecipe).toHaveBeenCalledWith(88, "1");
    expect(storage.abandonMakingSuggestion).toHaveBeenCalledWith(5, token);
  });
  it("429s at the daily limit before taking the lock", async () => {
    vi.mocked(storage.getInspiredSuggestion).mockResolvedValue(row());
    vi.mocked(storage.getDailyRecipeGenerationCount).mockResolvedValue(999);
    const res = await make();
    expect(res.status).toBe(429);
    expect(storage.startMakingSuggestion).not.toHaveBeenCalled();
  });
});
