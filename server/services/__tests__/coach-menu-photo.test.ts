import { describe, it, expect, vi, beforeEach } from "vitest";
import { analyzeMenuPhoto } from "../menu-analysis";
import { loadAllergyProfile } from "../barcode-scan-context";
import { storage } from "../../storage";
import { suggestionListSchema } from "@shared/schemas/coach-blocks";
import { AI_DAILY_CAPS } from "@shared/types/premium";
import { detectAllergens } from "@shared/constants/allergens";
import {
  flagAllergenDishes,
  menuPhotoReply,
  menuToPicks,
  MENU_TEXT,
} from "../coach-menu-photo";

vi.mock("../menu-analysis", () => ({ analyzeMenuPhoto: vi.fn() }));
vi.mock("../barcode-scan-context", () => ({ loadAllergyProfile: vi.fn() }));
vi.mock("../../storage", () => ({
  storage: { claimDailyAiCall: vi.fn(), createMenuScan: vi.fn() },
}));
// The real matcher, wrapped so one test can make it throw.
vi.mock("@shared/constants/allergens", async (orig) => {
  const actual = await orig<typeof import("@shared/constants/allergens")>();
  return { ...actual, detectAllergens: vi.fn(actual.detectAllergens) };
});

type Menu = Awaited<ReturnType<typeof analyzeMenuPhoto>>;
type Dish = Menu["menuItems"][number];

function dish(over: Partial<Dish> = {}): Dish {
  return {
    name: "Grilled Salmon",
    description: "with greens",
    price: "$18",
    estimatedCalories: 624.4,
    estimatedProtein: 42.6,
    estimatedCarbs: 20,
    estimatedFat: 30,
    tags: ["high-protein"],
    recommendation: "great",
    recommendationReason: "High protein, fits your calorie target",
    ...over,
  };
}

function menu(items: Dish[], over: Partial<Menu> = {}): Menu {
  return { menuItems: items, restaurantName: "Some Place", ...over };
}

const padThai = dish({
  name: "Pad Thai",
  description: "rice noodles with crushed peanuts",
});
const peanutAllergy = [{ name: "peanuts", severity: "severe" as const }];

describe("menuToPicks", () => {
  it("shows the best-rated dishes first, at most 3, with rough numbers and the reason", () => {
    const { items } = menuToPicks(
      menu([
        dish({ name: "Fries", recommendation: "okay" }),
        dish({ name: "Chicken Bowl", recommendation: "good" }),
        dish(),
        dish({ name: "Soup", recommendation: "good" }),
      ]),
    );
    expect(items.map((i) => i.title)).toEqual([
      "Grilled Salmon",
      "Chicken Bowl",
      "Soup",
    ]);
    // Calories to the nearest 10: the estimate is rough.
    expect(items[0]).toEqual({
      title: "Grilled Salmon",
      subtitle:
        "About 620 kcal, 43 g protein. High protein, fits your calorie target",
      action: null,
    });
  });

  it("leaves out dishes rated avoid", () => {
    const { items, allergyLeftOut } = menuToPicks(
      menu([dish({ recommendation: "avoid" }), dish({ name: "Salad" })]),
    );
    expect(items.map((i) => i.title)).toEqual(["Salad"]);
    expect(allergyLeftOut).toBe(0);
  });

  it("leaves out and counts the dishes flagged for the user's allergies", () => {
    const { items, allergyLeftOut } = menuToPicks(
      menu([padThai, dish({ name: "Salad" })]),
      new Set([0]),
    );
    expect(items.map((i) => i.title)).toEqual(["Salad"]);
    expect(allergyLeftOut).toBe(1);
  });

  it("ranks unrated dishes after rated ones and drops the reason when there is none", () => {
    const { items } = menuToPicks(
      menu([
        dish({
          name: "Plain",
          recommendation: undefined,
          recommendationReason: undefined,
        }),
        dish({ name: "Rated", recommendation: "okay" }),
      ]),
    );
    expect(items.map((i) => i.title)).toEqual(["Rated", "Plain"]);
    expect(items[1].subtitle).toBe("About 620 kcal, 43 g protein");
  });

  it("cleans and clips menu text, and leaves out a dish with no name", () => {
    const { items } = menuToPicks(
      menu([
        dish({ name: "  " }),
        dish({
          name: "Sal\u200bmon\u202e " + "x".repeat(200),
          recommendationReason: "r".repeat(300),
          estimatedCalories: Number.NaN,
        }),
        dish({ name: "Steak", estimatedCalories: -5 }),
      ]),
    );
    // A dish with unusable numbers shows without them.
    expect(items.map((i) => i.title.slice(0, 6))).toEqual(["Salmon", "Steak"]);
    expect(items[0].title.startsWith("Salmon x")).toBe(true);
    expect([...items[0].title].length).toBeLessThanOrEqual(80);
    expect(items[0].subtitle.length).toBeLessThanOrEqual(160);
    expect(items[0].subtitle).not.toMatch(/kcal/);
    expect(items[1].subtitle).not.toMatch(/kcal/);
  });

  it("makes a block the app can draw", () => {
    const { items } = menuToPicks(menu([dish()]));
    expect(
      suggestionListSchema.safeParse({ type: "suggestion_list", items })
        .success,
    ).toBe(true);
  });
});

describe("flagAllergenDishes", () => {
  it("flags each dish whose name or description names an allergen, duplicates included", () => {
    const flagged = flagAllergenDishes(
      menu([padThai, dish({ name: "Salad" }), padThai]),
      peanutAllergy,
    );
    expect([...flagged].sort()).toEqual([0, 2]);
  });

  it("flags nothing for a user with no allergies", () => {
    expect(flagAllergenDishes(menu([padThai]), []).size).toBe(0);
  });
});

describe("menuPhotoReply", () => {
  const ctx = { userId: "u1", menuScanner: true };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(storage.claimDailyAiCall).mockResolvedValue(true);
    vi.mocked(analyzeMenuPhoto).mockResolvedValue(menu([dish()]));
    vi.mocked(loadAllergyProfile).mockResolvedValue({
      ok: true,
      allergies: [],
    });
  });

  it("reads the menu into a list of picks and saves the scan to the menu history", async () => {
    const reply = await menuPhotoReply("BASE64", ctx);
    expect(storage.claimDailyAiCall).toHaveBeenCalledWith(
      "u1",
      "menuScan",
      AI_DAILY_CAPS.menuScan,
    );
    expect(analyzeMenuPhoto).toHaveBeenCalledWith("BASE64", "u1");
    expect(storage.createMenuScan).toHaveBeenCalledWith({
      userId: "u1",
      restaurantName: "Some Place",
      cuisine: null,
      menuItems: [dish()],
    });
    expect(reply?.payload).toBeNull();
    expect(reply?.suggestions?.type).toBe("suggestion_list");
    expect(reply?.suggestions?.items[0].title).toBe("Grilled Salmon");
    expect(reply?.text).toBe(MENU_TEXT);
  });

  it("leaves out an allergen dish, says so without naming it, and always adds the menu caveat", async () => {
    vi.mocked(loadAllergyProfile).mockResolvedValue({
      ok: true,
      allergies: peanutAllergy,
    });
    vi.mocked(analyzeMenuPhoto).mockResolvedValue(menu([dish(), padThai]));
    const reply = await menuPhotoReply("BASE64", ctx);
    expect(reply?.suggestions?.items.map((i) => i.title)).toEqual([
      "Grilled Salmon",
    ]);
    expect(reply?.text).not.toMatch(/salmon|pad thai|peanut/i);
    expect(reply?.text).toMatch(/left out 1 dish/);
    expect(reply?.text).toMatch(/check with the restaurant/);

    // The caveat stands even when no dish was left out.
    vi.mocked(analyzeMenuPhoto).mockResolvedValue(menu([dish()]));
    const clean = await menuPhotoReply("BASE64", ctx);
    expect(clean?.text).toMatch(/check with the restaurant/);
    expect(clean?.text).not.toMatch(/left out/);
  });

  it("picks nothing when the allergy profile cannot be read", async () => {
    vi.mocked(loadAllergyProfile).mockResolvedValue({ ok: false });
    const reply = await menuPhotoReply("BASE64", ctx);
    expect(reply?.suggestions).toBeUndefined();
    expect(reply?.text).toMatch(
      /couldn't check that menu against your allergies/,
    );
  });

  it("picks nothing when the allergy check itself fails", async () => {
    vi.mocked(loadAllergyProfile).mockResolvedValue({
      ok: true,
      allergies: peanutAllergy,
    });
    vi.mocked(detectAllergens).mockImplementationOnce(() => {
      throw new Error("matcher broke");
    });
    const reply = await menuPhotoReply("BASE64", ctx);
    expect(reply?.suggestions).toBeUndefined();
    expect(reply?.text).toMatch(
      /couldn't check that menu against your allergies/,
    );
  });

  it("says when nothing on the menu fits", async () => {
    vi.mocked(analyzeMenuPhoto).mockResolvedValue(
      menu([dish({ recommendation: "avoid" })]),
    );
    const reply = await menuPhotoReply("BASE64", ctx);
    expect(reply?.suggestions).toBeUndefined();
    expect(reply?.text).toMatch(/couldn't find a dish/);
  });

  it("hands back no reply, and saves no scan, when the photo shows no dishes", async () => {
    vi.mocked(analyzeMenuPhoto).mockResolvedValue(menu([]));
    expect(await menuPhotoReply("BASE64", ctx)).toBeNull();
    expect(storage.createMenuScan).not.toHaveBeenCalled();
  });

  it("asks for the plan and spends nothing without the menu scanner", async () => {
    const reply = await menuPhotoReply("BASE64", {
      ...ctx,
      menuScanner: false,
    });
    expect(storage.claimDailyAiCall).not.toHaveBeenCalled();
    expect(analyzeMenuPhoto).not.toHaveBeenCalled();
    expect(reply?.text).toMatch(/menu scanner/);
  });

  it("stops at the daily menu limit without reading the menu", async () => {
    vi.mocked(storage.claimDailyAiCall).mockResolvedValue(false);
    const reply = await menuPhotoReply("BASE64", ctx);
    expect(analyzeMenuPhoto).not.toHaveBeenCalled();
    expect(reply?.text).toMatch(/limit/);
  });

  it("still answers when the menu history cannot be saved", async () => {
    vi.mocked(storage.createMenuScan).mockRejectedValue(new Error("db down"));
    const reply = await menuPhotoReply("BASE64", ctx);
    expect(reply?.suggestions?.items).toHaveLength(1);
  });
});
