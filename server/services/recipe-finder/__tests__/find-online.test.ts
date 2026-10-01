import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { findOnline } from "../find-online";
import { searchCatalogRecipes, CatalogQuotaError } from "../../recipe-catalog";

vi.mock("../../recipe-catalog", async () => {
  const actual = await vi.importActual<typeof import("../../recipe-catalog")>(
    "../../recipe-catalog",
  );
  return { ...actual, searchCatalogRecipes: vi.fn() };
});

const allergies = [
  { name: "peanuts", severity: "severe" },
  { name: "milk", severity: "mild" },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SPOONACULAR_API_KEY", "test-key");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("findOnline", () => {
  it("sends q, cuisine, diet, meal type, time and intolerances — and never asks for nutrition", async () => {
    vi.mocked(searchCatalogRecipes).mockResolvedValue({
      results: [
        {
          id: 715538,
          title: "Bowl",
          image: "https://img/1.jpg",
          readyInMinutes: 25,
        },
      ],
      offset: 0,
      number: 5,
      totalResults: 1,
    });
    const result = await findOnline(
      {
        q: "quinoa salad",
        cuisine: "mediterranean",
        diet: "vegan",
        mealType: "dinner",
        maxPrepTime: 20,
      },
      allergies,
    );
    expect(searchCatalogRecipes).toHaveBeenCalledWith(
      {
        query: "quinoa salad",
        number: 5,
        cuisine: "mediterranean",
        diet: "vegan",
        type: "main course",
        maxReadyTime: 20,
        intolerances: "peanut,dairy",
      },
      { strict: true },
    );
    expect(result).toEqual({
      status: "ok",
      items: [
        {
          id: 715538,
          source: "spoonacular",
          title: "Bowl",
          imageUrl: "https://img/1.jpg",
          readyInMinutes: 25,
          calories: null,
        },
      ],
    });
  });

  it("returns unavailable on a 402 quota error", async () => {
    vi.mocked(searchCatalogRecipes).mockRejectedValue(
      new CatalogQuotaError("Spoonacular API quota exceeded"),
    );
    await expect(findOnline({ q: "tacos" }, [])).resolves.toEqual({
      status: "unavailable",
    });
  });

  it("returns unavailable on a timeout/network error", async () => {
    vi.mocked(searchCatalogRecipes).mockRejectedValue(
      new DOMException(
        "The operation was aborted due to timeout",
        "TimeoutError",
      ),
    );
    await expect(findOnline({ q: "tacos" }, [])).resolves.toEqual({
      status: "unavailable",
    });
  });

  it("returns unavailable without a call when SPOONACULAR_API_KEY is unset", async () => {
    vi.stubEnv("SPOONACULAR_API_KEY", "");
    await expect(findOnline({ q: "tacos" }, [])).resolves.toEqual({
      status: "unavailable",
    });
    expect(searchCatalogRecipes).not.toHaveBeenCalled();
  });

  it("reports ok with zero items for a genuine empty result", async () => {
    vi.mocked(searchCatalogRecipes).mockResolvedValue({
      results: [],
      offset: 0,
      number: 5,
      totalResults: 0,
    });
    await expect(findOnline({ q: "zzz" }, [])).resolves.toEqual({
      status: "ok",
      items: [],
    });
  });
});
