import { describe, it, expect, vi, afterEach } from "vitest";
import { CatalogQuotaError } from "../recipe-catalog";

describe("Recipe Catalog", () => {
  describe("CatalogQuotaError", () => {
    it("is an instance of Error", () => {
      const err = new CatalogQuotaError("quota exceeded");
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe("CatalogQuotaError");
      expect(err.message).toBe("quota exceeded");
    });
  });

  describe("searchCatalogRecipes (with API key)", () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
      vi.resetModules();
      delete process.env.SPOONACULAR_API_KEY;
    });

    async function importWithKey() {
      vi.resetModules();
      process.env.SPOONACULAR_API_KEY = "test-key";
      return await import("../recipe-catalog");
    }

    it("returns empty results when no API key is set", async () => {
      // Re-import the module without an API key so the top-level capture
      // of process.env.SPOONACULAR_API_KEY is undefined.
      vi.resetModules();
      delete process.env.SPOONACULAR_API_KEY;
      const mod = await import("../recipe-catalog");
      const result = await mod.searchCatalogRecipes({ query: "pasta" });
      expect(result.results).toEqual([]);
      expect(result.totalResults).toBe(0);
    });

    it("returns parsed results on successful API response", async () => {
      const mockResponse = {
        results: [
          { id: 1, title: "Pasta", image: "img.jpg", readyInMinutes: 20 },
          { id: 2, title: "Salad", readyInMinutes: 10 },
        ],
        offset: 0,
        number: 10,
        totalResults: 2,
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockResponse),
      });

      const mod = await importWithKey();
      const result = await mod.searchCatalogRecipes({ query: "pasta" });
      expect(result.results).toHaveLength(2);
      expect(result.results[0].title).toBe("Pasta");
      expect(result.totalResults).toBe(2);
    });

    it("throws CatalogQuotaError on 402 response", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 402,
      });

      const mod = await importWithKey();
      await expect(
        mod.searchCatalogRecipes({ query: "pasta" }),
      ).rejects.toThrow(mod.CatalogQuotaError);
    });

    it("throws generic error on non-ok response", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });

      const mod = await importWithKey();
      await expect(
        mod.searchCatalogRecipes({ query: "pasta" }),
      ).rejects.toThrow("Spoonacular search failed: 500");
    });

    it("returns empty results on parse failure", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ invalid: "data" }),
      });

      const mod = await importWithKey();
      const result = await mod.searchCatalogRecipes({ query: "pasta" });
      expect(result.results).toEqual([]);
      expect(result.totalResults).toBe(0);
    });

    it("passes optional parameters to URL", async () => {
      const mockResponse = {
        results: [],
        offset: 0,
        number: 5,
        totalResults: 0,
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockResponse),
      });

      const mod = await importWithKey();
      await mod.searchCatalogRecipes({
        query: "soup",
        cuisine: "Italian",
        diet: "vegetarian",
        type: "main course",
        maxReadyTime: 30,
        offset: 10,
        number: 5,
      });

      const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
        .calls[0];
      const url = fetchCall[0] as string;
      expect(url).toContain("cuisine=Italian");
      expect(url).toContain("diet=vegetarian");
      expect(url).toContain("type=main+course");
      expect(url).toContain("maxReadyTime=30");
      expect(url).toContain("offset=10");
      expect(url).toContain("number=5");
    });
  });
});
