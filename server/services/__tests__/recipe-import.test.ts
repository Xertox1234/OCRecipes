// Mock node:dns before importing recipe-import so DNS resolution succeeds in tests
import {
  parseIsoDuration,
  normalizeInstructions,
  parseIngredientString,
  findRecipeInLdJson,
  importRecipeFromUrl,
  parseRecipeFromLdJson,
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

  describe("parseIsoDuration — full ISO 8601 forms (R37)", () => {
    it("accepts a day component", () => {
      expect(parseIsoDuration("P0DT30M")).toBe(30);
      expect(parseIsoDuration("P1DT2H")).toBe(26 * 60);
      expect(parseIsoDuration("P1D")).toBe(24 * 60);
    });

    it("accepts fractional values", () => {
      expect(parseIsoDuration("PT1.5H")).toBe(90);
      expect(parseIsoDuration("PT0.5M")).toBe(1);
    });

    it("rounds seconds into minutes", () => {
      expect(parseIsoDuration("PT90S")).toBe(2);
      expect(parseIsoDuration("PT10M30S")).toBe(11);
    });

    it("still rejects malformed strings", () => {
      expect(parseIsoDuration("P")).toBeNull();
      expect(parseIsoDuration("PT")).toBeNull();
      expect(parseIsoDuration("30 minutes")).toBeNull();
    });
  });

  describe("normalizeInstructions", () => {
    it("returns null for undefined", () => {
      expect(normalizeInstructions(undefined)).toBeNull();
    });

    it("returns array with trimmed string for string input", () => {
      expect(normalizeInstructions("Step 1. Cook.")).toEqual(["Step 1. Cook."]);
    });

    it("strips HTML from string input", () => {
      expect(normalizeInstructions("<p>Cook the <b>pasta</b></p>")).toEqual([
        "Cook the pasta",
      ]);
    });

    // Security audit 2026-11-12, L9 (review): a page that writes its method
    // as one HTML block has its steps in the tags, not in line breaks.
    it("takes the steps of an HTML list written on one line", () => {
      expect(
        normalizeInstructions(
          "<ol><li>Mix the <b>dough</b>.</li><li>Bake.</li></ol>",
        ),
      ).toEqual(["Mix the dough.", "Bake."]);
    });

    it("takes paragraphs and line-break tags as step breaks", () => {
      expect(
        normalizeInstructions("<p>Mix.</p><p>Rest.<br>Bake.<BR />Serve.</p>"),
      ).toEqual(["Mix.", "Rest.", "Bake.", "Serve."]);
    });

    // Security audit 2026-11-12, H1: the tag strip took quadratic time on a
    // run of "<" with no ">" (60,000 of them: about 2 s; a 2 MB page: the
    // server stops answering). Linear, the same input takes under 1 ms.
    it.each([
      ["a string", (text: string) => text],
      [
        "a HowToStep",
        (text: string) => [{ "@type": "HowToStep" as const, text }],
      ],
    ])("strips tags in linear time from %s", (_shape, wrap) => {
      const hostile = "<".repeat(60_000);
      const started = performance.now();
      normalizeInstructions(wrap(hostile));
      expect(performance.now() - started).toBeLessThan(500);
    });

    it("returns string[] from HowToStep array", () => {
      const steps = [
        { "@type": "HowToStep" as const, text: "Preheat oven" },
        { "@type": "HowToStep" as const, text: "Mix ingredients" },
      ];
      const result = normalizeInstructions(steps);
      expect(result).toEqual(["Preheat oven", "Mix ingredients"]);
    });

    it("handles array of plain strings", () => {
      const steps = ["Preheat oven", "Mix ingredients"];
      const result = normalizeInstructions(steps);
      expect(result).toEqual(["Preheat oven", "Mix ingredients"]);
    });

    it("strips HTML from HowToStep text", () => {
      const steps = [
        { "@type": "HowToStep" as const, text: "<p>Cook <b>pasta</b></p>" },
      ];
      expect(normalizeInstructions(steps)).toEqual(["Cook pasta"]);
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
      expect(isBlockedIPv6("2606:4700:4700::1111")).toBe(false);
    });

    it.each([
      "::ffff:0:7f00:1", // IPv4-translated (SIIT)
      "64:ff9b:1::a9fe:a9fe", // local-use NAT64
      "2001:0:4136:e378:8000:63bf:80ff:fffe", // Teredo
      "2001:10::1", // ORCHID
      "2001:db8::1", // documentation
      "100::1", // discard-only
      "fec0::1", // deprecated site-local
    ])("blocks the special-purpose IPv6 address %s", (ip) => {
      expect(isBlockedIPv6(ip)).toBe(true);
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
      expect(isBlockedIP("2606:4700:4700::1111")).toBe(false);
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

    // WHATWG URL rewrites [::ffff:127.0.0.1] to the hex form [::ffff:7f00:1],
    // which a dotted-quad regex never sees — audit 2026-10-29 H-sec-1.
    it.each([
      "http://[::ffff:127.0.0.1]/",
      "http://[::ffff:7f00:1]/",
      "http://[::ffff:169.254.169.254]/",
      "http://[::ffff:a9fe:a9fe]/",
      "http://[::ffff:10.0.0.1]/",
      "http://[::]/",
      "http://[::127.0.0.1]/",
      "http://[64:ff9b::7f00:1]/",
      "http://[2002:7f00:1::]/",
      "http://[ff02::1]/",
    ])("blocks the internal IPv6 literal %s", (url) => {
      expect(isBlockedUrl(url)).toBe(true);
    });

    it.each([
      "http://198.18.0.1/",
      "http://224.0.0.1/",
      "http://240.0.0.1/",
      "http://255.255.255.255/",
      "http://192.0.0.8/",
    ])("blocks the reserved IPv4 literal %s", (url) => {
      expect(isBlockedUrl(url)).toBe(true);
    });

    it.each([
      "http://[::ffff:8.8.8.8]/",
      "http://[2606:4700:4700::1111]/",
      "http://93.184.216.34/",
    ])("still allows the public literal %s", (url) => {
      expect(isBlockedUrl(url)).toBe(false);
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

    // URL.hostname keeps the brackets on an IPv6 literal, and that is what
    // the import path passes in.
    it("allows a bracketed public IPv6 literal from URL.hostname", async () => {
      const host = new URL("http://[2606:4700:4700::1111]/").hostname;
      expect(await resolveAndValidateHost(host)).toBe(true);
    });

    it("blocks a bracketed internal IPv6 literal from URL.hostname", async () => {
      const host = new URL("http://[::ffff:127.0.0.1]/").hostname;
      expect(await resolveAndValidateHost(host)).toBe(false);
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

    it("returns TIMEOUT when headers arrive but the body never finishes", async () => {
      // Headers come back at once, then the body drips forever. Like undici,
      // the body stream errors with an AbortError when the request's signal
      // aborts — so the deadline must still be armed while the body is read.
      globalThis.fetch = vi.fn().mockImplementation((_url, opts) => {
        const signal = opts?.signal as AbortSignal | undefined;
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("<html>"));
            signal?.addEventListener("abort", () =>
              controller.error(
                new DOMException("The operation was aborted.", "AbortError"),
              ),
            );
          },
        });
        return Promise.resolve(
          new Response(body, { status: 200, headers: new Headers() }),
        );
      });

      const result = await importRecipeFromUrl("https://example.com/drip");
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

    describe("lenient optional fields (R26)", () => {
      function mockPage(recipe: unknown) {
        const html = `<html><head><script type="application/ld+json">${JSON.stringify(recipe)}</script></head><body></body></html>`;
        const encoded = new TextEncoder().encode(html);
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoded);
            controller.close();
          },
        });
        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          headers: new Headers({
            "content-length": String(encoded.byteLength),
          }),
          body: stream,
        });
      }

      it("accepts ImageObject image, numeric yield/nutrition and HowToSection instructions", async () => {
        mockPage({
          "@type": "Recipe",
          name: "Real-World Recipe",
          image: {
            "@type": "ImageObject",
            url: "https://example.com/hero.jpg",
          },
          recipeYield: 6,
          recipeIngredient: ["1 cup rice"],
          recipeInstructions: [
            {
              "@type": "HowToSection",
              name: "Prep",
              itemListElement: [
                { "@type": "HowToStep", text: "Rinse rice" },
                { "@type": "HowToStep", text: "Soak rice" },
              ],
            },
            { "@type": "HowToStep", text: "Cook rice" },
          ],
          nutrition: { calories: 420, proteinContent: "9 g" },
        });

        const result = await importRecipeFromUrl("https://example.com/real");
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.imageUrl).toBe("https://example.com/hero.jpg");
          expect(result.data.servings).toBe(6);
          expect(result.data.instructions).toEqual([
            "Rinse rice",
            "Soak rice",
            "Cook rice",
          ]);
          expect(result.data.caloriesPerServing).toBe("420");
          expect(result.data.proteinPerServing).toBe("9");
        }
      });

      it("accepts an array of ImageObjects and drops non-http images", async () => {
        mockPage({
          "@type": "Recipe",
          name: "Images",
          image: [
            { "@type": "ImageObject", url: "javascript:alert(1)" },
            { "@type": "ImageObject", url: "https://example.com/a.jpg" },
          ],
        });
        const result = await importRecipeFromUrl("https://example.com/imgs");
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.imageUrl).toBe("https://example.com/a.jpg");
        }
      });

      it("drops an unusable optional field instead of failing the whole import", async () => {
        mockPage({
          "@type": "Recipe",
          name: "Odd Fields",
          image: 12345,
          recipeYield: { "@type": "QuantitativeValue", value: 4 },
          recipeCuisine: { name: "Thai" },
          keywords: 7,
          prepTime: 15,
          recipeIngredient: ["2 eggs", { text: "bad" }],
          nutrition: "lots",
        });
        const result = await importRecipeFromUrl("https://example.com/odd");
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.title).toBe("Odd Fields");
          expect(result.data.imageUrl).toBeNull();
          expect(result.data.servings).toBe(4);
          expect(result.data.prepTimeMinutes).toBeNull();
          expect(result.data.ingredients).toHaveLength(1);
          expect(result.data.caloriesPerServing).toBeNull();
        }
      });
    });

    describe("totalTime fallback and comma nutrition (R37)", () => {
      function mockPage(recipe: unknown) {
        const html = `<html><head><script type="application/ld+json">${JSON.stringify(recipe)}</script></head><body></body></html>`;
        const encoded = new TextEncoder().encode(html);
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoded);
            controller.close();
          },
        });
        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          headers: new Headers({
            "content-length": String(encoded.byteLength),
          }),
          body: stream,
        });
      }

      it("uses totalTime when prepTime and cookTime are both absent", async () => {
        mockPage({ "@type": "Recipe", name: "Total only", totalTime: "PT45M" });
        const result = await importRecipeFromUrl("https://example.com/t");
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.prepTimeMinutes).toBeNull();
          expect(result.data.cookTimeMinutes).toBe(45);
        }
      });

      it("does not override explicit prep/cook times with totalTime", async () => {
        mockPage({
          "@type": "Recipe",
          name: "Both",
          prepTime: "PT10M",
          totalTime: "PT45M",
        });
        const result = await importRecipeFromUrl("https://example.com/b");
        if (result.success) {
          expect(result.data.prepTimeMinutes).toBe(10);
          expect(result.data.cookTimeMinutes).toBeNull();
        }
      });

      it("strips thousands separators in nutrition values", async () => {
        mockPage({
          "@type": "Recipe",
          name: "Commas",
          nutrition: { calories: "1,046 kJ", proteinContent: "1,5 g" },
        });
        const result = await importRecipeFromUrl("https://example.com/c");
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.caloriesPerServing).toBe("250");
          // A comma not followed by exactly 3 digits is a decimal comma.
          expect(result.data.proteinPerServing).toBe("1.5");
        }
      });
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
        expect(result.data.instructions).toContain("Mix dry ingredients");
        expect(result.data.sourceUrl).toBe("https://example.com/full-recipe");
      }
    });
  });

  describe("parseRecipeFromLdJson", () => {
    const pieBlock =
      '{"@graph":[{"@type":"Recipe","name":"Pie","recipeIngredient":["1 egg"]}]}';

    it("returns the recipe from the first block containing one", () => {
      const result = parseRecipeFromLdJson(
        ['{"@type":"BreadcrumbList"}', pieBlock],
        "https://x.test/pie",
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.title).toBe("Pie");
        expect(result.data.ingredients.length).toBe(1);
        expect(result.data.sourceUrl).toBe("https://x.test/pie");
      }
    });

    // Security audit 2026-11-12, L9: an imported page is cut to the caps the
    // manual-create schema enforces (server/routes/_meal-plan-schemas.ts), so
    // a hostile page cannot store a multi-megabyte row and an imported recipe
    // can still be edited.
    it("cuts an oversized page down to the manual-create caps", () => {
      const block = JSON.stringify({
        "@type": "Recipe",
        name: "T".repeat(50_000),
        description: "a ".repeat(400_000),
        recipeYield: "99999999999 servings",
        prepTime: "P9999999D",
        cookTime: "PT99999999H",
        keywords: Array.from(
          { length: 5000 },
          (_, i) => `tag${i}${"x".repeat(60)}`,
        ).join(","),
        recipeCuisine: "c".repeat(30_000),
        recipeIngredient: Array.from(
          { length: 3000 },
          (_, i) => `1 cup thing${i}${"y".repeat(500)}`,
        ),
        recipeInstructions: Array.from(
          { length: 2000 },
          (_, i) => `step ${i} ${"z".repeat(5000)}`,
        ),
        nutrition: {
          calories: "99999999999 calories",
          proteinContent: "99999999 g",
          carbohydrateContent: "30 g",
          fatContent: "12 g",
        },
      });

      const result = parseRecipeFromLdJson([block], "https://x.test/big");

      expect(result.success).toBe(true);
      if (!result.success) return;
      const d = result.data;
      expect(d.title).toHaveLength(200);
      expect(d.description).toHaveLength(2000);
      expect(d.cuisine).toHaveLength(100);
      expect(d.servings).toBe(50);
      expect(d.prepTimeMinutes).toBe(1440);
      expect(d.cookTimeMinutes).toBe(1440);
      expect(d.dietTags).toHaveLength(20);
      expect(Math.max(...d.dietTags.map((t) => t.length))).toBe(50);
      expect(d.ingredients).toHaveLength(200);
      expect(Math.max(...d.ingredients.map((i) => i.name.length))).toBe(200);
      expect(d.instructions).toHaveLength(100);
      expect(Math.max(...(d.instructions ?? []).map((s) => s.length))).toBe(
        2000,
      );
      // A value no real serving has is treated as unreadable, not stored.
      expect(d.caloriesPerServing).toBeNull();
      expect(d.proteinPerServing).toBeNull();
      expect(d.carbsPerServing).toBe("30");
      expect(d.fatPerServing).toBe("12");
    });

    it("leaves an ordinary recipe as the page wrote it", () => {
      const block = JSON.stringify({
        "@type": "Recipe",
        name: "Sugar Cookies",
        description: "Soft and chewy.",
        recipeYield: "24 cookies",
        prepTime: "PT15M",
        cookTime: "PT10M",
        keywords: "dessert, cookies",
        recipeCuisine: "American",
        recipeIngredient: ["2 cups flour", "1 cup sugar"],
        recipeInstructions: ["Mix.", "Bake."],
        nutrition: { calories: "120 calories", proteinContent: "2 g" },
      });

      const result = parseRecipeFromLdJson([block], "https://x.test/cookies");

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data).toMatchObject({
        title: "Sugar Cookies",
        description: "Soft and chewy.",
        servings: 24,
        prepTimeMinutes: 15,
        cookTimeMinutes: 10,
        cuisine: "American",
        dietTags: ["dessert", "cookies"],
        instructions: ["Mix.", "Bake."],
        caloriesPerServing: "120",
        proteinPerServing: "2",
      });
      expect(result.data.ingredients).toHaveLength(2);
    });

    it("does not cut a title in the middle of an emoji", () => {
      const block = JSON.stringify({
        "@type": "Recipe",
        name: `${"T".repeat(199)}\u{1F370}`,
        recipeIngredient: ["1 egg"],
      });

      const result = parseRecipeFromLdJson([block], "https://x.test/cake");

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.title).toBe("T".repeat(199));
    });

    it("skips invalid JSON blocks", () => {
      const result = parseRecipeFromLdJson(
        ["{not json", pieBlock],
        "https://x.test/pie",
      );
      expect(result.success).toBe(true);
    });

    it("returns NO_RECIPE_DATA when no block has a Recipe", () => {
      expect(
        parseRecipeFromLdJson(['{"@type":"Article"}'], "https://x.test/a"),
      ).toEqual({ success: false, error: "NO_RECIPE_DATA" });
    });

    it("returns NO_RECIPE_DATA for an empty array", () => {
      expect(parseRecipeFromLdJson([], "https://x.test/a")).toEqual({
        success: false,
        error: "NO_RECIPE_DATA",
      });
    });

    it("returns PARSE_ERROR when the Recipe fails the schema", () => {
      const invalid = JSON.stringify({
        "@type": "Recipe",
        description: "A recipe without a name",
      });
      expect(parseRecipeFromLdJson([invalid], "https://x.test/a")).toEqual({
        success: false,
        error: "PARSE_ERROR",
      });
    });
  });
});
