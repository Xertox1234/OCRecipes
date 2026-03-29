import { describe, it, expect, vi, beforeEach } from "vitest";
import { analyzeReceiptPhotos, _testInternals } from "../receipt-analysis";

import { openai } from "../../lib/openai";
import { createMockChatCompletion } from "../../__tests__/factories";

const { receiptItemSchema, receiptAnalysisSchema } = _testInternals;

// Mock OpenAI
vi.mock("../../lib/openai", () => ({
  openai: {
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
  },
}));

vi.mock("../../lib/ai-safety", () => ({
  SYSTEM_PROMPT_BOUNDARY: "--- SYSTEM BOUNDARY ---",
}));

function mockOpenAIResponse(content: string) {
  vi.mocked(openai.chat.completions.create).mockResolvedValue(
    createMockChatCompletion(content),
  );
}

describe("Receipt Analysis Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("receiptItemSchema", () => {
    it("validates a complete food item", () => {
      const valid = {
        name: "Organic Chicken Breast",
        originalName: "ORG CKEN BRST",
        quantity: 2,
        unit: "lb",
        category: "meat",
        isFood: true,
        estimatedShelfLifeDays: 5,
        confidence: 0.9,
      };
      expect(receiptItemSchema.safeParse(valid).success).toBe(true);
    });

    it("defaults quantity to 1 when not provided", () => {
      const item = {
        name: "Milk",
        originalName: "2% MLK",
        category: "dairy",
        isFood: true,
        estimatedShelfLifeDays: 14,
        confidence: 0.85,
      };
      const result = receiptItemSchema.safeParse(item);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.quantity).toBe(1);
      }
    });

    it("accepts optional unit field", () => {
      const item = {
        name: "Bananas",
        originalName: "BANANAS",
        quantity: 6,
        category: "produce",
        isFood: true,
        estimatedShelfLifeDays: 7,
        confidence: 0.95,
      };
      const result = receiptItemSchema.safeParse(item);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.unit).toBeUndefined();
      }
    });

    it("rejects invalid category", () => {
      const item = {
        name: "Product",
        originalName: "PROD",
        category: "electronics",
        isFood: true,
        estimatedShelfLifeDays: 30,
        confidence: 0.5,
      };
      expect(receiptItemSchema.safeParse(item).success).toBe(false);
    });

    it("rejects shelf life below 1", () => {
      const item = {
        name: "Product",
        originalName: "PROD",
        category: "other",
        isFood: true,
        estimatedShelfLifeDays: 0,
        confidence: 0.5,
      };
      expect(receiptItemSchema.safeParse(item).success).toBe(false);
    });

    it("rejects shelf life above 730", () => {
      const item = {
        name: "Product",
        originalName: "PROD",
        category: "other",
        isFood: true,
        estimatedShelfLifeDays: 731,
        confidence: 0.5,
      };
      expect(receiptItemSchema.safeParse(item).success).toBe(false);
    });

    it("rejects confidence above 1", () => {
      const item = {
        name: "Product",
        originalName: "PROD",
        category: "other",
        isFood: true,
        estimatedShelfLifeDays: 30,
        confidence: 1.5,
      };
      expect(receiptItemSchema.safeParse(item).success).toBe(false);
    });

    it("rejects negative confidence", () => {
      const item = {
        name: "Product",
        originalName: "PROD",
        category: "other",
        isFood: true,
        estimatedShelfLifeDays: 30,
        confidence: -0.1,
      };
      expect(receiptItemSchema.safeParse(item).success).toBe(false);
    });

    it("rejects negative quantity", () => {
      const item = {
        name: "Product",
        originalName: "PROD",
        quantity: -1,
        category: "other",
        isFood: true,
        estimatedShelfLifeDays: 30,
        confidence: 0.5,
      };
      expect(receiptItemSchema.safeParse(item).success).toBe(false);
    });

    it("validates all valid categories", () => {
      const categories = [
        "produce",
        "meat",
        "seafood",
        "dairy",
        "bakery",
        "grains",
        "canned",
        "condiments",
        "spices",
        "frozen",
        "beverages",
        "snacks",
        "other",
      ];
      for (const category of categories) {
        const item = {
          name: "Test",
          originalName: "TST",
          category,
          isFood: true,
          estimatedShelfLifeDays: 30,
          confidence: 0.5,
        };
        expect(receiptItemSchema.safeParse(item).success).toBe(true);
      }
    });

    it("validates non-food items", () => {
      const item = {
        name: "Paper Towels",
        originalName: "PPR TWLS",
        category: "other",
        isFood: false,
        estimatedShelfLifeDays: 365,
        confidence: 0.8,
      };
      expect(receiptItemSchema.safeParse(item).success).toBe(true);
    });
  });

  describe("receiptAnalysisSchema", () => {
    it("validates a complete analysis result", () => {
      const valid = {
        items: [
          {
            name: "Chicken Breast",
            originalName: "CKEN BRST",
            quantity: 1,
            category: "meat",
            isFood: true,
            estimatedShelfLifeDays: 5,
            confidence: 0.9,
          },
        ],
        storeName: "Walmart",
        purchaseDate: "2026-03-25",
        totalAmount: "$42.50",
        isPartialExtraction: false,
        overallConfidence: 0.85,
      };
      expect(receiptAnalysisSchema.safeParse(valid).success).toBe(true);
    });

    it("validates minimal result with defaults", () => {
      const minimal = {
        items: [],
        overallConfidence: 0.5,
      };
      const result = receiptAnalysisSchema.safeParse(minimal);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.isPartialExtraction).toBe(false);
        expect(result.data.storeName).toBeUndefined();
        expect(result.data.purchaseDate).toBeUndefined();
        expect(result.data.totalAmount).toBeUndefined();
      }
    });

    it("rejects missing overallConfidence", () => {
      const invalid = {
        items: [],
      };
      expect(receiptAnalysisSchema.safeParse(invalid).success).toBe(false);
    });

    it("rejects overallConfidence above 1", () => {
      const invalid = {
        items: [],
        overallConfidence: 1.5,
      };
      expect(receiptAnalysisSchema.safeParse(invalid).success).toBe(false);
    });
  });

  describe("analyzeReceiptPhotos", () => {
    it("analyzes a single receipt photo and returns food items", async () => {
      const response = {
        items: [
          {
            name: "Organic Milk",
            originalName: "ORG 2% MLK",
            quantity: 1,
            unit: "gal",
            category: "dairy",
            isFood: true,
            estimatedShelfLifeDays: 14,
            confidence: 0.9,
          },
          {
            name: "Paper Towels",
            originalName: "PPR TWLS",
            quantity: 1,
            category: "other",
            isFood: false,
            estimatedShelfLifeDays: 365,
            confidence: 0.8,
          },
        ],
        storeName: "Costco",
        purchaseDate: "2026-03-25",
        totalAmount: "$55.00",
        isPartialExtraction: false,
        overallConfidence: 0.88,
      };
      mockOpenAIResponse(JSON.stringify(response));

      const result = await analyzeReceiptPhotos(["base64imagedata"]);

      // Non-food items should be filtered out
      expect(result.items).toHaveLength(1);
      expect(result.items[0].name).toBe("Organic Milk");
      expect(result.storeName).toBe("Costco");
      expect(result.overallConfidence).toBe(0.88);
    });

    it("filters out non-food items", async () => {
      const response = {
        items: [
          {
            name: "Eggs",
            originalName: "LG EGGS",
            quantity: 1,
            category: "dairy",
            isFood: true,
            estimatedShelfLifeDays: 21,
            confidence: 0.95,
          },
          {
            name: "Dish Soap",
            originalName: "DSH SOAP",
            quantity: 1,
            category: "other",
            isFood: false,
            estimatedShelfLifeDays: 365,
            confidence: 0.9,
          },
          {
            name: "Trash Bags",
            originalName: "TRSH BGS",
            quantity: 1,
            category: "other",
            isFood: false,
            estimatedShelfLifeDays: 365,
            confidence: 0.85,
          },
        ],
        isPartialExtraction: false,
        overallConfidence: 0.9,
      };
      mockOpenAIResponse(JSON.stringify(response));

      const result = await analyzeReceiptPhotos(["base64data"]);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].name).toBe("Eggs");
    });

    it("handles multiple receipt photos", async () => {
      const response = {
        items: [
          {
            name: "Bread",
            originalName: "WHL WHT BRD",
            quantity: 1,
            category: "bakery",
            isFood: true,
            estimatedShelfLifeDays: 7,
            confidence: 0.85,
          },
        ],
        isPartialExtraction: false,
        overallConfidence: 0.8,
      };
      mockOpenAIResponse(JSON.stringify(response));

      const result = await analyzeReceiptPhotos([
        "photo1base64",
        "photo2base64",
        "photo3base64",
      ]);

      expect(result.items).toHaveLength(1);
      // Verify OpenAI was called with all images
      const callArgs = vi.mocked(openai.chat.completions.create).mock
        .calls[0][0] as { messages: { content: unknown }[] };
      const userMessage = callArgs.messages[1].content as {
        type: string;
      }[];
      // 3 images + 1 text prompt
      expect(userMessage).toHaveLength(4);
    });

    it("uses plural text for multiple photos", async () => {
      const response = {
        items: [],
        isPartialExtraction: false,
        overallConfidence: 0.5,
      };
      mockOpenAIResponse(JSON.stringify(response));

      await analyzeReceiptPhotos(["photo1", "photo2"]);

      const callArgs = vi.mocked(openai.chat.completions.create).mock
        .calls[0][0] as { messages: { content: unknown }[] };
      const userContent = callArgs.messages[1].content as {
        type: string;
        text?: string;
      }[];
      const textPart = userContent.find((c) => c.type === "text");
      expect(textPart?.text).toContain("2 receipt photos");
    });

    it("uses singular text for single photo", async () => {
      const response = {
        items: [],
        isPartialExtraction: false,
        overallConfidence: 0.5,
      };
      mockOpenAIResponse(JSON.stringify(response));

      await analyzeReceiptPhotos(["photo1"]);

      const callArgs = vi.mocked(openai.chat.completions.create).mock
        .calls[0][0] as { messages: { content: unknown }[] };
      const userContent = callArgs.messages[1].content as {
        type: string;
        text?: string;
      }[];
      const textPart = userContent.find((c) => c.type === "text");
      expect(textPart?.text).toContain("this receipt photo");
    });

    it("throws on OpenAI API error", async () => {
      vi.mocked(openai.chat.completions.create).mockRejectedValue(
        new Error("API timeout"),
      );

      await expect(analyzeReceiptPhotos(["base64data"])).rejects.toThrow(
        "Failed to analyze receipt photo",
      );
    });

    it("throws when OpenAI returns no content", async () => {
      vi.mocked(openai.chat.completions.create).mockResolvedValue(
        createMockChatCompletion(null),
      );

      await expect(analyzeReceiptPhotos(["base64data"])).rejects.toThrow(
        "No response from receipt analysis",
      );
    });

    it("throws when OpenAI returns invalid JSON", async () => {
      mockOpenAIResponse("not valid json {{");

      await expect(analyzeReceiptPhotos(["base64data"])).rejects.toThrow(
        "Receipt analysis returned invalid data",
      );
    });

    it("throws when OpenAI returns unexpected schema", async () => {
      mockOpenAIResponse(
        JSON.stringify({ unexpected: "format", items: "not-array" }),
      );

      await expect(analyzeReceiptPhotos(["base64data"])).rejects.toThrow(
        "Receipt analysis returned unexpected data",
      );
    });

    it("handles partial extraction flag", async () => {
      const response = {
        items: [
          {
            name: "Apple",
            originalName: "APPLES",
            quantity: 3,
            category: "produce",
            isFood: true,
            estimatedShelfLifeDays: 10,
            confidence: 0.7,
          },
        ],
        isPartialExtraction: true,
        overallConfidence: 0.6,
      };
      mockOpenAIResponse(JSON.stringify(response));

      const result = await analyzeReceiptPhotos(["base64data"]);

      expect(result.isPartialExtraction).toBe(true);
    });

    it("returns empty items array when all items are non-food", async () => {
      const response = {
        items: [
          {
            name: "Bleach",
            originalName: "BLEACH",
            quantity: 1,
            category: "other",
            isFood: false,
            estimatedShelfLifeDays: 365,
            confidence: 0.9,
          },
        ],
        isPartialExtraction: false,
        overallConfidence: 0.9,
      };
      mockOpenAIResponse(JSON.stringify(response));

      const result = await analyzeReceiptPhotos(["base64data"]);

      expect(result.items).toHaveLength(0);
    });
  });
});
