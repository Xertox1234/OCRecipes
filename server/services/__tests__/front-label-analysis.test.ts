import { describe, it, expect, vi, beforeEach } from "vitest";
import { analyzeFrontLabel } from "../front-label-analysis";

const mockCreate = vi.fn();

vi.mock("../../lib/openai", () => ({
  openai: {
    chat: {
      completions: {
        create: (...args: unknown[]) => mockCreate(...args),
      },
    },
  },
  MODEL_FAST: "gpt-4o-mini",
  MODEL_HEAVY: "gpt-4o",
}));

vi.mock("../../lib/ai-safety", () => ({
  SYSTEM_PROMPT_BOUNDARY: "---BOUNDARY---",
}));

function mockVisionResponse(content: object) {
  mockCreate.mockResolvedValueOnce({
    choices: [{ message: { content: JSON.stringify(content) } }],
  });
}

describe("front-label-analysis", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("analyzeFrontLabel", () => {
    it("extracts all fields from a valid response", async () => {
      mockVisionResponse({
        brand: "Kind",
        productName: "Dark Chocolate Nuts & Sea Salt",
        netWeight: "40g",
        claims: ["No Added Sugar", "Gluten Free", "Non-GMO"],
        confidence: 0.92,
      });

      const result = await analyzeFrontLabel("base64data");

      expect(result.brand).toBe("Kind");
      expect(result.productName).toBe("Dark Chocolate Nuts & Sea Salt");
      expect(result.netWeight).toBe("40g");
      expect(result.claims).toEqual([
        "No Added Sugar",
        "Gluten Free",
        "Non-GMO",
      ]);
      expect(result.confidence).toBe(0.92);
    });

    it("handles partial extraction (some fields null)", async () => {
      mockVisionResponse({
        brand: "Cheerios",
        productName: null,
        netWeight: null,
        claims: ["Heart Healthy"],
        confidence: 0.6,
      });

      const result = await analyzeFrontLabel("base64data");

      expect(result.brand).toBe("Cheerios");
      expect(result.productName).toBeNull();
      expect(result.netWeight).toBeNull();
      expect(result.claims).toEqual(["Heart Healthy"]);
      expect(result.confidence).toBe(0.6);
    });

    it("handles empty extraction (all null/empty)", async () => {
      mockVisionResponse({
        brand: null,
        productName: null,
        netWeight: null,
        claims: [],
        confidence: 0.2,
      });

      const result = await analyzeFrontLabel("base64data");

      expect(result.brand).toBeNull();
      expect(result.productName).toBeNull();
      expect(result.netWeight).toBeNull();
      expect(result.claims).toEqual([]);
      expect(result.confidence).toBe(0.2);
    });

    it("returns fallback result on malformed API response", async () => {
      mockVisionResponse({
        unexpected: "data",
      });

      const result = await analyzeFrontLabel("base64data");

      expect(result.brand).toBeNull();
      expect(result.productName).toBeNull();
      expect(result.claims).toEqual([]);
      expect(result.confidence).toBe(0);
    });

    it("returns fallback result on API error", async () => {
      mockCreate.mockRejectedValueOnce(new Error("API timeout"));

      const result = await analyzeFrontLabel("base64data");

      expect(result.brand).toBeNull();
      expect(result.confidence).toBe(0);
    });

    it("truncates fields exceeding max length", async () => {
      const longString = "A".repeat(300);
      mockVisionResponse({
        brand: longString,
        productName: "Normal Name",
        netWeight: "40g",
        claims: [longString],
        confidence: 0.9,
      });

      const result = await analyzeFrontLabel("base64data");

      expect(result.brand!.length).toBe(200);
      expect(result.claims[0].length).toBe(200);
    });

    it("caps claims at 20 entries", async () => {
      const manyClaims = Array.from({ length: 30 }, (_, i) => `Claim ${i}`);
      mockVisionResponse({
        brand: "Test",
        productName: "Product",
        netWeight: "100g",
        claims: manyClaims,
        confidence: 0.85,
      });

      const result = await analyzeFrontLabel("base64data");

      expect(result.claims.length).toBe(20);
    });

    it("filters out empty claim strings", async () => {
      mockVisionResponse({
        brand: "Test",
        productName: "Product",
        netWeight: "100g",
        claims: ["Valid Claim", "", "  ", "Another Valid"],
        confidence: 0.85,
      });

      const result = await analyzeFrontLabel("base64data");

      expect(result.claims).toEqual(["Valid Claim", "Another Valid"]);
    });

    it("uses detail: low for cost efficiency", async () => {
      mockVisionResponse({
        brand: "Test",
        productName: null,
        netWeight: null,
        claims: [],
        confidence: 0.5,
      });

      await analyzeFrontLabel("base64data");

      const callArgs = mockCreate.mock.calls[0][0];
      const imageContent = callArgs.messages[1].content.find(
        (c: { type: string }) => c.type === "image_url",
      );
      expect(imageContent.image_url.detail).toBe("low");
    });

    it("sanitizes whitespace-only brand to null", async () => {
      mockVisionResponse({
        brand: "   ",
        productName: "Product",
        netWeight: "40g",
        claims: [],
        confidence: 0.8,
      });

      const result = await analyzeFrontLabel("base64data");

      expect(result.brand).toBeNull();
    });
  });
});
