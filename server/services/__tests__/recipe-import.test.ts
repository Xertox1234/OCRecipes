// Mock node:dns before importing recipe-import so DNS resolution succeeds in tests
import {
  parseIsoDuration,
  normalizeInstructions,
  parseIngredientString,
  findRecipeInLdJson,
  importRecipeFromUrl,
  MAX_RESPONSE_BYTES,
} from "../recipe-import";

vi.mock("node:dns", () => {
  const lookup = vi
    .fn()
    .mockResolvedValue({ address: "93.184.216.34", family: 4 });
  return {
    default: { promises: { lookup } },
    promises: { lookup },
  };
});

describe("Recipe Import", () => {
  describe("parseIsoDuration", () => {
    it("parses minutes only", () => {
      expect(parseIsoDuration("PT15M")).toBe(15);
    });

    it("parses hours and minutes", () => {
      expect(parseIsoDuration("PT1H30M")).toBe(90);
    });

    it("parses hours only", () => {
      expect(parseIsoDuration("PT2H")).toBe(120);
    });

    it("returns null for undefined", () => {
      expect(parseIsoDuration(undefined)).toBeNull();
    });

    it("returns null for invalid format", () => {
      expect(parseIsoDuration("invalid")).toBeNull();
      expect(parseIsoDuration("")).toBeNull();
    });

    it("handles zero minutes", () => {
      expect(parseIsoDuration("PT0M")).toBe(0);
    });
  });

  describe("normalizeInstructions", () => {
    it("returns null for undefined", () => {
      expect(normalizeInstructions(undefined)).toBeNull();
    });

    it("returns trimmed string for string input", () => {
      expect(normalizeInstructions("Step 1. Cook.")).toBe("Step 1. Cook.");
    });

    it("strips HTML from string input", () => {
      expect(normalizeInstructions("<p>Cook the <b>pasta</b></p>")).toBe(
        "Cook the pasta",
      );
    });

    it("formats HowToStep array with numbered steps", () => {
      const steps = [
        { "@type": "HowToStep" as const, text: "Preheat oven" },
        { "@type": "HowToStep" as const, text: "Mix ingredients" },
      ];
      const result = normalizeInstructions(steps);
      expect(result).toBe("1. Preheat oven\n2. Mix ingredients");
    });

    it("handles array of plain strings", () => {
      const steps = ["Preheat oven", "Mix ingredients"];
      const result = normalizeInstructions(steps);
      expect(result).toBe("1. Preheat oven\n2. Mix ingredients");
    });

    it("strips HTML from HowToStep text", () => {
      const steps = [
        { "@type": "HowToStep" as const, text: "<p>Cook <b>pasta</b></p>" },
      ];
      expect(normalizeInstructions(steps)).toBe("1. Cook pasta");
    });
  });

  describe("parseIngredientString", () => {
    it("parses quantity, unit, and name", () => {
      const result = parseIngredientString("2 cups flour");
      expect(result).toEqual({
        name: "flour",
        quantity: "2",
        unit: "cups",
      });
    });

    it("parses fraction quantities", () => {
      const result = parseIngredientString("1/2 tsp salt");
      expect(result).toEqual({
        name: "salt",
        quantity: "1/2",
        unit: "tsp",
      });
    });

    it("handles ingredient with no unit", () => {
      const result = parseIngredientString("3 large eggs");
      expect(result).toEqual({
        name: "eggs",
        quantity: "3",
        unit: "large",
      });
    });

    it("handles ingredient with no quantity or unit", () => {
      const result = parseIngredientString("salt and pepper to taste");
      expect(result.name).toBeTruthy();
    });

    it("handles 'of' connector", () => {
      const result = parseIngredientString("1 cup of sugar");
      expect(result).toEqual({
        name: "sugar",
        quantity: "1",
        unit: "cup",
      });
    });

    it("trims whitespace", () => {
      const result = parseIngredientString("  2 tbsp olive oil  ");
      expect(result).toEqual({
        name: "olive oil",
        quantity: "2",
        unit: "tbsp",
      });
    });
  });

  describe("findRecipeInLdJson", () => {
    it("finds top-level Recipe", () => {
      const data = { "@type": "Recipe", name: "Test Recipe" };
      expect(findRecipeInLdJson(data)).toEqual(data);
    });

    it("finds Recipe in @graph", () => {
      const recipe = { "@type": "Recipe", name: "Test Recipe" };
      const data = {
        "@context": "https://schema.org",
        "@graph": [{ "@type": "WebPage", name: "Page" }, recipe],
      };
      expect(findRecipeInLdJson(data)).toEqual(recipe);
    });

    it("finds Recipe in top-level array", () => {
      const recipe = { "@type": "Recipe", name: "Test Recipe" };
      expect(findRecipeInLdJson([recipe])).toEqual(recipe);
    });

    it("handles @type as array", () => {
      const data = { "@type": ["Recipe", "CreativeWork"], name: "Test" };
      expect(findRecipeInLdJson(data)).toEqual(data);
    });

    it("returns null for non-Recipe data", () => {
      expect(
        findRecipeInLdJson({ "@type": "Article", name: "Test" }),
      ).toBeNull();
    });

    it("returns null for null/undefined", () => {
      expect(findRecipeInLdJson(null)).toBeNull();
      expect(findRecipeInLdJson(undefined)).toBeNull();
    });

    it("returns null for empty object", () => {
      expect(findRecipeInLdJson({})).toBeNull();
    });
  });

  describe("importRecipeFromUrl – timeout and size limits", () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it("returns TIMEOUT when fetch exceeds the time limit", async () => {
      globalThis.fetch = vi.fn().mockImplementation((_url, opts) => {
        const signal = opts?.signal as AbortSignal | undefined;
        return new Promise((_resolve, reject) => {
          // Simulate a slow server: wait until abort fires
          if (signal) {
            signal.addEventListener("abort", () => {
              const err = new DOMException(
                "The operation was aborted.",
                "AbortError",
              );
              reject(err);
            });
          }
        });
      });

      const result = await importRecipeFromUrl("https://example.com/slow");
      expect(result).toEqual({ success: false, error: "TIMEOUT" });
    }, 15_000);

    it("returns RESPONSE_TOO_LARGE when Content-Length exceeds limit", async () => {
      const oversizedLength = MAX_RESPONSE_BYTES + 1;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ "content-length": String(oversizedLength) }),
        body: null,
      });

      const result = await importRecipeFromUrl("https://example.com/huge-page");
      expect(result).toEqual({ success: false, error: "RESPONSE_TOO_LARGE" });
    });

    it("returns RESPONSE_TOO_LARGE when streamed body exceeds limit", async () => {
      // Create a ReadableStream that emits more than MAX_RESPONSE_BYTES
      const chunkSize = 1024 * 1024; // 1 MB per chunk
      const totalChunks = 6; // 6 MB > 5 MB limit
      let chunksSent = 0;

      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (chunksSent < totalChunks) {
            controller.enqueue(new Uint8Array(chunkSize));
            chunksSent++;
          } else {
            controller.close();
          }
        },
      });

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(), // No Content-Length header
        body: stream,
      });

      const result = await importRecipeFromUrl(
        "https://example.com/stream-big",
      );
      expect(result).toEqual({ success: false, error: "RESPONSE_TOO_LARGE" });
    });

    it("accepts a response within the size limit", async () => {
      // Build a small HTML page with valid LD+JSON recipe data
      const recipeJson = JSON.stringify({
        "@type": "Recipe",
        name: "Small Recipe",
        recipeIngredient: ["1 cup flour"],
      });
      const html = `<html><head><script type="application/ld+json">${recipeJson}</script></head><body></body></html>`;
      const encoder = new TextEncoder();
      const encoded = encoder.encode(html);

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoded);
          controller.close();
        },
      });

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ "content-length": String(encoded.byteLength) }),
        body: stream,
      });

      const result = await importRecipeFromUrl(
        "https://example.com/small-recipe",
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.title).toBe("Small Recipe");
      }
    });

    it("returns FETCH_FAILED for non-ok responses", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        headers: new Headers(),
      });

      const result = await importRecipeFromUrl(
        "https://example.com/error-page",
      );
      expect(result).toEqual({ success: false, error: "FETCH_FAILED" });
    });

    it("returns FETCH_FAILED for network errors", async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

      const result = await importRecipeFromUrl("https://example.com/down");
      expect(result).toEqual({ success: false, error: "FETCH_FAILED" });
    });

    it("returns FETCH_FAILED for blocked URLs", async () => {
      const result = await importRecipeFromUrl("https://127.0.0.1/recipe");
      expect(result).toEqual({ success: false, error: "FETCH_FAILED" });
    });
  });
});
