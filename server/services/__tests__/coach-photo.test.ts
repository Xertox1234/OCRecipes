import { describe, it, expect, vi, beforeEach } from "vitest";
import { analyzePhoto } from "../photo-analysis";
import { batchNutritionLookup } from "../nutrition-lookup";
import type { NutritionData } from "../nutrition-lookup";
import {
  buildPhotoFoodCard,
  photoFoodsToCardItems,
  photoReplyText,
  COACH_PHOTO_USER_TEXT,
} from "../coach-photo";
import { foodCardPayloadSchema } from "@shared/schemas/coach-write-cards";

vi.mock("../photo-analysis", () => ({ analyzePhoto: vi.fn() }));
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

it("has a fixed user-message text", () => {
  expect(COACH_PHOTO_USER_TEXT).toBe("Photo of my meal");
});
