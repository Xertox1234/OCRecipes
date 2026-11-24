import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  analyzePhoto,
  analyzeLabelPhoto,
  classifyPhoto,
} from "../photo-analysis";
import {
  loadAllergyProfile,
  loadBarcodeScanContext,
} from "../barcode-scan-context";
import type { BarcodeLookupResult } from "../barcode-lookup";
import { UpstreamUnavailableError } from "../usda-lookup";
import type { LabelExtractionResult } from "@shared/types/label-analysis";
import { batchNutritionLookup } from "../nutrition-lookup";
import type { NutritionData } from "../nutrition-lookup";
import {
  buildPhotoFoodCard,
  buildPhotoReply,
  hasValidCheckDigit,
  photoFoodsToCardItems,
  scannedBarcodeReply,
  photoReplyText,
  COACH_PHOTO_USER_TEXT,
} from "../coach-photo";
import { foodCardPayloadSchema } from "@shared/schemas/coach-write-cards";

vi.mock("../photo-analysis", () => ({
  analyzePhoto: vi.fn(),
  analyzeLabelPhoto: vi.fn(),
  classifyPhoto: vi.fn(),
}));
vi.mock("../barcode-scan-context", () => ({
  loadBarcodeScanContext: vi.fn(),
  loadAllergyProfile: vi.fn(),
}));
vi.mock("../nutrition-lookup", () => ({ batchNutritionLookup: vi.fn() }));

/** Per 100 g, as the lookup answers. */
function per100g(over: Partial<NutritionData> = {}): NutritionData {
  return {
    name: "chicken breast",
    calories: 165,
    protein: 31,
    carbs: 0,
    fat: 3.6,
    fiber: 0,
    sugar: 0,
    sodium: 74,
    servingSize: "100g",
    source: "usda",
    ...over,
  };
}

function food(over: Record<string, unknown> = {}) {
  return {
    name: "Grilled chicken breast",
    quantity: "1 breast",
    lookupName: "chicken breast",
    grams: 200,
    confidence: 0.9,
    needsClarification: false,
    category: "protein" as const,
    ...over,
  };
}

describe("photoFoodsToCardItems", () => {
  it("makes one row per food, scaled to the portion seen, count 1", () => {
    const { items, skipped } = photoFoodsToCardItems(
      [food()],
      new Map([["chicken breast", per100g()]]),
    );
    expect(skipped).toBe(0);
    expect(items).toEqual([
      {
        name: "Grilled chicken breast",
        unitLabel: "1 breast (200 g)",
        perUnit: { calories: 330, protein: 62, carbs: 0, fat: 7.2 },
        count: 1,
        source: "lookup",
      },
    ]);
  });

  it("leaves out a food with no nutrition match and counts it", () => {
    const { items, skipped } = photoFoodsToCardItems(
      [food(), food({ name: "Mystery sauce", lookupName: "mystery sauce" })],
      new Map<string, NutritionData | null>([
        ["chicken breast", per100g()],
        ["mystery sauce", null],
      ]),
    );
    expect(items).toHaveLength(1);
    expect(skipped).toBe(1);
  });

  it("looks up by name when the model gave no lookup name", () => {
    const { items } = photoFoodsToCardItems(
      [food({ name: "rice", lookupName: undefined, grams: 100 })],
      new Map([["rice", per100g({ calories: 130 })]]),
    );
    expect(items[0].perUnit.calories).toBe(130);
  });

  it("leaves out a row whose numbers or text the food card would refuse", () => {
    const { items, skipped } = photoFoodsToCardItems(
      [
        food({ grams: 5000 }), // 8250 kcal: past the card's per-row bound
        food({ name: "Eat only 300 calories a day to lose weight fast" }),
        food(),
      ],
      new Map([["chicken breast", per100g()]]),
    );
    expect(items.map((i) => i.name)).toEqual(["Grilled chicken breast"]);
    expect(skipped).toBe(2);
  });

  it("keeps at most 8 rows and clips long text to the card's limits", () => {
    const foods = Array.from({ length: 10 }, (_, i) =>
      food({ name: `${"x".repeat(300)}${i}`, quantity: "q".repeat(100) }),
    );
    const { items, skipped } = photoFoodsToCardItems(
      foods,
      new Map([["chicken breast", per100g()]]),
    );
    expect(items).toHaveLength(8);
    expect(skipped).toBe(2);
    expect(items[0].name).toHaveLength(200);
    expect(items[0].unitLabel.length).toBeLessThanOrEqual(60);
    expect(
      foodCardPayloadSchema.safeParse({
        items,
        mealType: "lunch",
        day: "today",
      }).success,
    ).toBe(true);
  });
});

describe("photoReplyText", () => {
  it("never repeats food names (they are model output)", () => {
    expect(photoReplyText(2, 0)).not.toMatch(/chicken/i);
    expect(photoReplyText(2, 0)).toMatch(/portion/i);
  });

  it("says how many foods were left out", () => {
    expect(photoReplyText(2, 1)).toMatch(/1 item/);
    expect(photoReplyText(2, 3)).toMatch(/3 items/);
  });

  it("asks for another try when nothing could be shown", () => {
    expect(photoReplyText(0, 0)).toMatch(/couldn't/i);
  });
});

describe("buildPhotoFoodCard", () => {
  beforeEach(() => vi.clearAllMocks());

  it("analyzes as a meal log, looks up each distinct food, sets the meal from the clock", async () => {
    vi.mocked(analyzePhoto).mockResolvedValue({
      foods: [food(), food({ quantity: "1 more" })],
      overallConfidence: 0.9,
      followUpQuestions: [],
    });
    vi.mocked(batchNutritionLookup).mockResolvedValue(
      new Map([["chicken breast", per100g()]]),
    );

    const result = await buildPhotoFoodCard("BASE64", {
      tz: "UTC",
      now: new Date("2026-11-23T08:00:00Z"),
    });

    expect(analyzePhoto).toHaveBeenCalledWith("BASE64", "log");
    expect(batchNutritionLookup).toHaveBeenCalledWith(["chicken breast"]);
    expect(result.payload?.items).toHaveLength(2);
    expect(result.payload?.mealType).toBe("breakfast");
    expect(result.payload?.day).toBe("today");
    expect(result.skipped).toBe(0);
  });

  it("looks up at most 12 foods however many the photo lists", async () => {
    vi.mocked(analyzePhoto).mockResolvedValue({
      foods: Array.from({ length: 30 }, (_, i) =>
        food({ name: `food ${i}`, lookupName: `food ${i}` }),
      ),
      overallConfidence: 0.9,
      followUpQuestions: [],
    });
    vi.mocked(batchNutritionLookup).mockResolvedValue(new Map());
    const result = await buildPhotoFoodCard("BASE64", {
      tz: "UTC",
      now: new Date(),
    });
    expect(vi.mocked(batchNutritionLookup).mock.calls[0][0]).toHaveLength(12);
    expect(result.skipped).toBe(30);
  });

  it("returns no payload when no food has nutrition", async () => {
    vi.mocked(analyzePhoto).mockResolvedValue({
      foods: [],
      overallConfidence: 0.2,
      followUpQuestions: [],
    });
    vi.mocked(batchNutritionLookup).mockResolvedValue(new Map());
    const result = await buildPhotoFoodCard("BASE64", {
      tz: "UTC",
      now: new Date(),
    });
    expect(result.payload).toBeNull();
  });
});

it("has a fixed user-message text that fits a meal, a label or a barcode", () => {
  expect(COACH_PHOTO_USER_TEXT).toBe("Sent a photo");
});

describe("hasValidCheckDigit", () => {
  it.each(["4006381333931", "036000291452", "96385074"])("accepts %s", (code) =>
    expect(hasValidCheckDigit(code)).toBe(true),
  );
  it.each(["4006381333932", "036000291453", "123456", "40063813339", "abc"])(
    "refuses %s",
    (code) => expect(hasValidCheckDigit(code)).toBe(false),
  );
});

function label(
  over: Partial<LabelExtractionResult> = {},
): LabelExtractionResult {
  return {
    servingSize: "2/3 cup (55g)",
    servingsPerContainer: 8,
    calories: 230,
    totalFat: 8,
    saturatedFat: 1,
    transFat: 0,
    cholesterol: 0,
    sodium: 160,
    totalCarbs: 37,
    dietaryFiber: 4,
    totalSugars: 12,
    addedSugars: 10,
    protein: 3,
    vitaminD: null,
    calcium: null,
    iron: null,
    potassium: null,
    confidence: 0.9,
    productName: "Crunchy Granola",
    ...over,
  };
}

function product(over: Partial<BarcodeLookupResult> = {}): BarcodeLookupResult {
  return {
    productName: "Oat Drink",
    brandName: "Oatly",
    barcode: "4006381333931",
    per100g: { calories: 46, protein: 1, carbs: 6.7, fat: 1.5 },
    perServing: { calories: 115, protein: 2.5, carbs: 16.75, fat: 3.75 },
    servingInfo: { displayLabel: "250 ml", grams: 250, wasCorrected: false },
    isServingDataTrusted: true,
    source: "openfoodfacts",
    allergenDataAvailable: true,
    allergenTags: [],
    ...over,
  };
}

const ctx = {
  tz: "UTC",
  now: new Date("2026-11-24T12:30:00Z"),
  userId: "u1",
};

function scanContext(
  result: BarcodeLookupResult | null,
  allergies: { name: string; severity: "mild" | "moderate" | "severe" }[] = [],
) {
  vi.mocked(loadBarcodeScanContext).mockResolvedValue({
    result,
    verification: undefined,
    profileOutcome: { ok: true, allergies },
    // The verification row is not read by the Coach's reply.
  } as unknown as Awaited<ReturnType<typeof loadBarcodeScanContext>>);
}

describe("buildPhotoReply", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(analyzePhoto).mockResolvedValue({
      foods: [food()],
      overallConfidence: 0.9,
      followUpQuestions: [],
    });
    vi.mocked(batchNutritionLookup).mockResolvedValue(
      new Map([["chicken breast", per100g()]]),
    );
    vi.mocked(loadAllergyProfile).mockResolvedValue({
      ok: true,
      allergies: [],
    });
  });

  it("treats a meal photo as before", async () => {
    vi.mocked(classifyPhoto).mockResolvedValue({
      contentType: "prepared_meal",
      confidence: 0.95,
      barcode: null,
    });
    const reply = await buildPhotoReply("BASE64", ctx);
    expect(reply.payload?.items[0].name).toBe("Grilled chicken breast");
    expect(reply.text).toBe(photoReplyText(1, 0));
    expect(analyzeLabelPhoto).not.toHaveBeenCalled();
    expect(loadBarcodeScanContext).not.toHaveBeenCalled();
  });

  it("falls back to the meal reading when the photo cannot be classified", async () => {
    vi.mocked(classifyPhoto).mockRejectedValue(new Error("classify down"));
    const reply = await buildPhotoReply("BASE64", ctx);
    expect(reply.payload?.items).toHaveLength(1);
    expect(analyzePhoto).toHaveBeenCalledWith("BASE64", "log");
  });

  it("falls back to the meal reading when the classifier is unsure", async () => {
    vi.mocked(classifyPhoto).mockResolvedValue({
      contentType: "nutrition_label",
      confidence: 0.5,
      barcode: null,
    });
    await buildPhotoReply("BASE64", ctx);
    expect(analyzePhoto).toHaveBeenCalled();
    expect(analyzeLabelPhoto).not.toHaveBeenCalled();
  });

  describe("a nutrition label", () => {
    beforeEach(() => {
      vi.mocked(classifyPhoto).mockResolvedValue({
        contentType: "nutrition_label",
        confidence: 0.92,
        barcode: null,
      });
    });

    it("becomes a one-row card: one serving, the label's numbers", async () => {
      vi.mocked(analyzeLabelPhoto).mockResolvedValue(label());
      const reply = await buildPhotoReply("BASE64", ctx);
      expect(analyzePhoto).not.toHaveBeenCalled();
      expect(reply.payload).toEqual({
        items: [
          {
            name: "Crunchy Granola",
            unitLabel: "1 serving (2/3 cup (55g))",
            perUnit: { calories: 230, protein: 3, carbs: 37, fat: 8 },
            count: 1,
            source: "lookup",
          },
        ],
        mealType: "lunch",
        day: "today",
      });
      expect(foodCardPayloadSchema.safeParse(reply.payload).success).toBe(true);
      expect(reply.text).toMatch(/label/i);
      // The product name is text read from a picture: on the card only.
      expect(reply.text).not.toContain("Granola");
    });

    it("has a plain name and serving when the label shows neither", async () => {
      vi.mocked(analyzeLabelPhoto).mockResolvedValue(
        label({ productName: null, servingSize: null }),
      );
      const reply = await buildPhotoReply("BASE64", ctx);
      expect(reply.payload?.items[0]).toMatchObject({
        name: "Packaged food",
        unitLabel: "1 serving",
      });
    });

    it("says so when a macro could not be read, and shows it as 0", async () => {
      vi.mocked(analyzeLabelPhoto).mockResolvedValue(label({ protein: null }));
      const reply = await buildPhotoReply("BASE64", ctx);
      expect(reply.payload?.items[0].perUnit.protein).toBe(0);
      expect(reply.text).toMatch(/couldn't read every number/i);
    });

    it("offers no card when the calories could not be read", async () => {
      vi.mocked(analyzeLabelPhoto).mockResolvedValue(label({ calories: null }));
      const reply = await buildPhotoReply("BASE64", ctx);
      expect(reply.payload).toBeNull();
      expect(reply.text).toMatch(/calories/i);
    });

    it("offers no card for numbers the food card would refuse, and does not blame the photo", async () => {
      vi.mocked(analyzeLabelPhoto).mockResolvedValue(
        label({ calories: 9_999_999 }),
      );
      const reply = await buildPhotoReply("BASE64", ctx);
      expect(reply.payload).toBeNull();
      expect(reply.text).toMatch(/tell me what it was/i);
    });

    it("asks for a check of every number when the label was hard to read", async () => {
      vi.mocked(analyzeLabelPhoto).mockResolvedValue(
        label({ confidence: 0.4 }),
      );
      const reply = await buildPhotoReply("BASE64", ctx);
      expect(reply.payload).not.toBeNull();
      expect(reply.text).toMatch(/hard to read/i);
    });

    it("says nothing about allergies to a user who has none", async () => {
      vi.mocked(analyzeLabelPhoto).mockResolvedValue(label());
      const reply = await buildPhotoReply("BASE64", ctx);
      expect(loadAllergyProfile).toHaveBeenCalledWith("u1");
      expect(reply.text).not.toMatch(/allerg/i);
    });

    it.each([
      [
        "has allergies",
        {
          ok: true as const,
          allergies: [{ name: "milk", severity: "severe" as const }],
        },
      ],
      ["could not be read", { ok: false as const }],
    ])(
      "says it cannot check ingredients when the profile %s",
      async (_name, outcome) => {
        vi.mocked(analyzeLabelPhoto).mockResolvedValue(label());
        vi.mocked(loadAllergyProfile).mockResolvedValue(outcome);
        const reply = await buildPhotoReply("BASE64", ctx);
        expect(reply.payload).not.toBeNull();
        expect(reply.text).toMatch(/can't check ingredients/i);
        expect(reply.text).not.toMatch(/milk/i);
      },
    );
  });

  describe("a barcode", () => {
    const seen = (barcode: string | null) =>
      vi.mocked(classifyPhoto).mockResolvedValue({
        contentType: "has_barcode",
        confidence: 0.9,
        barcode,
      });

    it("becomes a one-row card for the product, one serving", async () => {
      seen("4006381333931");
      scanContext(product());
      const reply = await buildPhotoReply("BASE64", ctx);
      expect(loadBarcodeScanContext).toHaveBeenCalledWith(
        "4006381333931",
        "u1",
      );
      expect(reply.payload?.items).toEqual([
        {
          name: "Oatly Oat Drink",
          unitLabel: "250 ml",
          perUnit: { calories: 115, protein: 2.5, carbs: 16.8, fat: 3.8 },
          count: 1,
          source: "lookup",
        },
      ]);
      expect(reply.text).toMatch(/barcode/i);
      expect(reply.text).not.toContain("Oat");
      expect(reply.text).not.toMatch(/allerg/i);
    });

    it("never looks up a number whose check digit is wrong (a misread)", async () => {
      seen("4006381333932");
      const reply = await buildPhotoReply("BASE64", ctx);
      expect(loadBarcodeScanContext).not.toHaveBeenCalled();
      expect(analyzePhoto).not.toHaveBeenCalled();
      expect(reply.payload).toBeNull();
      expect(reply.text).toMatch(/couldn't read its number/i);
    });

    it("asks for the label when no number could be read", async () => {
      seen(null);
      const reply = await buildPhotoReply("BASE64", ctx);
      expect(reply.payload).toBeNull();
      expect(reply.text).toMatch(/nutrition label/i);
    });

    it("asks for the label when the product is unknown", async () => {
      seen("4006381333931");
      scanContext(null);
      const reply = await buildPhotoReply("BASE64", ctx);
      expect(reply.payload).toBeNull();
      expect(reply.text).toMatch(/couldn't find that product/i);
    });

    it("asks for the label when the product has no calories", async () => {
      seen("4006381333931");
      scanContext(product({ perServing: {} }));
      const reply = await buildPhotoReply("BASE64", ctx);
      expect(reply.payload).toBeNull();
      expect(reply.text).toMatch(/no nutrition/i);
    });

    it("says so when the product's serving size is not known", async () => {
      seen("4006381333931");
      scanContext(product({ isServingDataTrusted: false }));
      const reply = await buildPhotoReply("BASE64", ctx);
      expect(reply.text).toMatch(/don't know this product's serving size/i);
    });

    it("says so when a macro is missing, and shows it as 0", async () => {
      seen("4006381333931");
      scanContext(product({ perServing: { calories: 115, protein: 2.5 } }));
      const reply = await buildPhotoReply("BASE64", ctx);
      expect(reply.payload?.items[0].perUnit).toEqual({
        calories: 115,
        protein: 2.5,
        carbs: 0,
        fat: 0,
      });
      expect(reply.text).toMatch(/some show as 0/i);
    });

    it("does not show the lookup's placeholder name", async () => {
      seen("4006381333931");
      scanContext(product({ productName: "Unknown Product", brandName: "" }));
      const reply = await buildPhotoReply("BASE64", ctx);
      expect(reply.payload?.items[0].name).toBe("Packaged food");
    });

    it("does not call a refused row a product with no nutrition", async () => {
      seen("4006381333931");
      scanContext(product({ perServing: { calories: 9_999_999 } }));
      const reply = await buildPhotoReply("BASE64", ctx);
      expect(reply.payload).toBeNull();
      expect(reply.text).toMatch(/tell me what it was/i);
    });

    it("warns, without naming it, when the product has one of the user's allergens", async () => {
      seen("4006381333931");
      scanContext(product({ allergenTags: ["en:milk"] }), [
        { name: "milk", severity: "severe" },
      ]);
      const reply = await buildPhotoReply("BASE64", ctx);
      expect(reply.payload).not.toBeNull();
      expect(reply.text).toMatch(/allergy list/i);
      expect(reply.text).not.toMatch(/milk/i);
    });

    it("says it could not check allergies when the product has no allergen data", async () => {
      seen("4006381333931");
      scanContext(product({ allergenDataAvailable: false }), [
        { name: "milk", severity: "severe" },
      ]);
      const reply = await buildPhotoReply("BASE64", ctx);
      expect(reply.text).toMatch(/couldn't check/i);
    });

    it("reads the label when the photo shows a label and a barcode", async () => {
      vi.mocked(classifyPhoto).mockResolvedValue({
        contentType: "nutrition_label",
        confidence: 0.9,
        barcode: "4006381333931",
      });
      vi.mocked(analyzeLabelPhoto).mockResolvedValue(label());
      await buildPhotoReply("BASE64", ctx);
      expect(analyzeLabelPhoto).toHaveBeenCalled();
      expect(loadBarcodeScanContext).not.toHaveBeenCalled();
    });
  });
});

describe("scannedBarcodeReply (a barcode read by the camera)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("looks the number up and offers the same one-serving card as a barcode photo", async () => {
    scanContext(product());
    const reply = await scannedBarcodeReply("4006381333931", ctx);
    expect(loadBarcodeScanContext).toHaveBeenCalledWith("4006381333931", "u1");
    expect(classifyPhoto).not.toHaveBeenCalled();
    expect(reply.payload?.items).toEqual([
      {
        name: "Oatly Oat Drink",
        unitLabel: "250 ml",
        perUnit: { calories: 115, protein: 2.5, carbs: 16.8, fat: 3.8 },
        count: 1,
        source: "lookup",
      },
    ]);
    expect(reply.text).not.toContain("Oat");
  });

  it("gives the allergy warning a barcode photo gets", async () => {
    scanContext(product({ allergenTags: ["en:milk"] }), [
      { name: "milk", severity: "severe" },
    ]);
    const reply = await scannedBarcodeReply("4006381333931", ctx);
    expect(reply.text).toMatch(/allergy check/i);
    expect(reply.text).not.toMatch(/milk/i);
  });

  it("asks for the label when the product is unknown", async () => {
    scanContext(null);
    const reply = await scannedBarcodeReply("4006381333931", ctx);
    expect(reply.payload).toBeNull();
    expect(reply.text).toMatch(/nutrition label/i);
  });

  it("asks for another try, not a label, when every lookup source is down", async () => {
    vi.mocked(loadBarcodeScanContext).mockRejectedValue(
      new UpstreamUnavailableError(),
    );
    const reply = await scannedBarcodeReply("4006381333931", ctx);
    expect(reply.payload).toBeNull();
    expect(reply.text).toMatch(/try again/i);
    expect(reply.text).not.toMatch(/couldn't find/i);
  });

  it("rejects on any other failure", async () => {
    vi.mocked(loadBarcodeScanContext).mockRejectedValue(new Error("db down"));
    await expect(scannedBarcodeReply("4006381333931", ctx)).rejects.toThrow(
      "db down",
    );
  });
});
