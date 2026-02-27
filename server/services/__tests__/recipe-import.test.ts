// Mock node:dns before importing recipe-import so DNS resolution succeeds in tests
import {
  parseIsoDuration,
  normalizeInstructions,
  parseIngredientString,
  findRecipeInLdJson,
  importRecipeFromUrl,
  isBlockedIPv4,
  isBlockedIPv6,
  isBlockedIP,
  isBlockedUrl,
  resolveAndValidateHost,
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

  describe("isBlockedIPv4", () => {
    it("blocks private ranges", () => {
      expect(isBlockedIPv4("10.0.0.1")).toBe(true);
      expect(isBlockedIPv4("172.16.0.1")).toBe(true);
      expect(isBlockedIPv4("172.31.255.255")).toBe(true);
      expect(isBlockedIPv4("192.168.1.1")).toBe(true);
    });

    it("blocks loopback", () => {
      expect(isBlockedIPv4("127.0.0.1")).toBe(true);
      expect(isBlockedIPv4("127.255.255.255")).toBe(true);
    });

    it("blocks current network", () => {
      expect(isBlockedIPv4("0.0.0.0")).toBe(true);
    });

    it("blocks CGNAT range", () => {
      expect(isBlockedIPv4("100.64.0.1")).toBe(true);
      expect(isBlockedIPv4("100.127.255.255")).toBe(true);
    });

    it("blocks link-local", () => {
      expect(isBlockedIPv4("169.254.1.1")).toBe(true);
    });

    it("allows public IPs", () => {
      expect(isBlockedIPv4("8.8.8.8")).toBe(false);
      expect(isBlockedIPv4("93.184.216.34")).toBe(false);
    });

    it("blocks malformed IPs", () => {
      expect(isBlockedIPv4("not.an.ip.address")).toBe(true);
      expect(isBlockedIPv4("256.1.2.3")).toBe(true);
    });
  });

  describe("isBlockedIPv6", () => {
    it("blocks loopback", () => {
      expect(isBlockedIPv6("::1")).toBe(true);
    });

    it("blocks IPv4-mapped IPv6 with private IPv4", () => {
      expect(isBlockedIPv6("::ffff:127.0.0.1")).toBe(true);
      expect(isBlockedIPv6("::ffff:10.0.0.1")).toBe(true);
    });

    it("allows IPv4-mapped IPv6 with public IPv4", () => {
      expect(isBlockedIPv6("::ffff:8.8.8.8")).toBe(false);
    });

    it("blocks unique local addresses", () => {
      expect(isBlockedIPv6("fc00::1")).toBe(true);
      expect(isBlockedIPv6("fd12:3456::1")).toBe(true);
    });

    it("blocks link-local", () => {
      expect(isBlockedIPv6("fe80::1")).toBe(true);
    });

    it("allows public IPv6", () => {
      expect(isBlockedIPv6("2001:db8::1")).toBe(false);
    });
  });

  describe("isBlockedIP", () => {
    it("handles hex IPv4 representations", () => {
      expect(isBlockedIP("0x7f000001")).toBe(true); // 127.0.0.1
      expect(isBlockedIP("0x0a000001")).toBe(true); // 10.0.0.1
      expect(isBlockedIP("0x08080808")).toBe(false); // 8.8.8.8
    });

    it("blocks malformed hex IPs", () => {
      expect(isBlockedIP("0xZZZZZZZZ")).toBe(true);
    });

    it("delegates IPv6 to isBlockedIPv6", () => {
      expect(isBlockedIP("::1")).toBe(true);
      expect(isBlockedIP("2001:db8::1")).toBe(false);
    });

    it("delegates IPv4 to isBlockedIPv4", () => {
      expect(isBlockedIP("192.168.0.1")).toBe(true);
      expect(isBlockedIP("8.8.4.4")).toBe(false);
    });
  });

  describe("isBlockedUrl", () => {
    it("blocks non-http protocols", () => {
      expect(isBlockedUrl("ftp://example.com")).toBe(true);
      expect(isBlockedUrl("file:///etc/passwd")).toBe(true);
    });

    it("blocks localhost variations", () => {
      expect(isBlockedUrl("http://localhost/path")).toBe(true);
      expect(isBlockedUrl("http://127.0.0.1/path")).toBe(true);
      expect(isBlockedUrl("http://0.0.0.0/path")).toBe(true);
    });

    it("blocks IPv6 loopback", () => {
      expect(isBlockedUrl("http://[::1]/path")).toBe(true);
    });

    it("allows public URLs", () => {
      expect(isBlockedUrl("https://example.com/recipe")).toBe(false);
      expect(isBlockedUrl("http://allrecipes.com/recipe/123")).toBe(false);
    });

    it("blocks invalid URLs", () => {
      expect(isBlockedUrl("not a url")).toBe(true);
    });
  });

  describe("resolveAndValidateHost", () => {
    it("allows public hostnames", async () => {
      const result = await resolveAndValidateHost("example.com");
      expect(result).toBe(true);
    });

    it("blocks literal private IPs without DNS resolution", async () => {
      const result = await resolveAndValidateHost("192.168.1.1");
      expect(result).toBe(false);
    });

    it("allows literal public IPs", async () => {
      const result = await resolveAndValidateHost("93.184.216.34");
      expect(result).toBe(true);
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

    it("returns NO_RECIPE_DATA when page has no LD+JSON", async () => {
      const html = `<html><head></head><body><p>No recipe here</p></body></html>`;
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

      const result = await importRecipeFromUrl("https://example.com/no-recipe");
      expect(result).toEqual({ success: false, error: "NO_RECIPE_DATA" });
    });

    it("returns PARSE_ERROR when LD+JSON has Recipe type but invalid schema", async () => {
      // Has @type: Recipe but missing required fields like name
      const invalidRecipe = JSON.stringify({
        "@type": "Recipe",
        // name is required but missing
        description: "A recipe without a name",
      });
      const html = `<html><head><script type="application/ld+json">${invalidRecipe}</script></head><body></body></html>`;
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
        "https://example.com/bad-recipe",
      );
      expect(result).toEqual({ success: false, error: "PARSE_ERROR" });
    });

    it("parses full recipe with nutrition, keywords, and all optional fields", async () => {
      const recipeJson = JSON.stringify({
        "@type": "Recipe",
        name: "Full Recipe",
        description: "A complete recipe",
        image: ["https://example.com/img.jpg"],
        recipeIngredient: ["2 cups flour", "1 tsp salt"],
        recipeInstructions: [
          { "@type": "HowToStep", text: "Mix dry ingredients" },
          { "@type": "HowToStep", text: "Add wet ingredients" },
        ],
        prepTime: "PT10M",
        cookTime: "PT30M",
        recipeYield: "4 servings",
        recipeCuisine: "Italian",
        keywords: "pasta,dinner,easy",
        nutrition: {
          calories: "350 calories",
          proteinContent: "12g",
          carbohydrateContent: "45g",
          fatContent: "15g",
        },
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
        "https://example.com/full-recipe",
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.title).toBe("Full Recipe");
        expect(result.data.description).toBe("A complete recipe");
        expect(result.data.servings).toBe(4);
        expect(result.data.prepTimeMinutes).toBe(10);
        expect(result.data.cookTimeMinutes).toBe(30);
        expect(result.data.cuisine).toBe("Italian");
        expect(result.data.dietTags).toEqual(["pasta", "dinner", "easy"]);
        expect(result.data.ingredients).toHaveLength(2);
        expect(result.data.caloriesPerServing).toBe("350");
        expect(result.data.proteinPerServing).toBe("12");
        expect(result.data.carbsPerServing).toBe("45");
        expect(result.data.fatPerServing).toBe("15");
        expect(result.data.imageUrl).toBe("https://example.com/img.jpg");
        expect(result.data.instructions).toContain("1. Mix dry ingredients");
        expect(result.data.sourceUrl).toBe("https://example.com/full-recipe");
      }
    });
  });
});
