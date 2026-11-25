import { describe, it, expect, vi, beforeEach } from "vitest";
import { analyzeMenuPhoto } from "../menu-analysis";
import { storage } from "../../storage";
import { suggestionListSchema } from "@shared/schemas/coach-blocks";
import { AI_DAILY_CAPS } from "@shared/types/premium";
import type { AllergenMatch } from "@shared/constants/allergens";
import { menuPhotoReply, menuToPicks, MENU_TEXT } from "../coach-menu-photo";

vi.mock("../menu-analysis", () => ({ analyzeMenuPhoto: vi.fn() }));
vi.mock("../../storage", () => ({
  storage: { claimDailyAiCall: vi.fn(), createMenuScan: vi.fn() },
}));

type Menu = Awaited<ReturnType<typeof analyzeMenuPhoto>>;
type Dish = Menu["menuItems"][number];

function dish(over: Partial<Dish> = {}): Dish {
  return {
    name: "Grilled Salmon",
    description: "with greens",
    price: "$18",
    estimatedCalories: 620.4,
    estimatedProtein: 42.6,
    estimatedCarbs: 20,
    estimatedFat: 30,
    tags: ["high-protein"],
    recommendation: "great",
    recommendationReason: "High protein, fits your calorie target",
    ...over,
  };
}

const peanutMatch: AllergenMatch = {
  allergenId: "peanuts",
  severity: "severe",
  ingredientName: "peanuts",
  matchedKeyword: "peanut",
  isDerived: false,
  isPossible: false,
};

function menu(items: Dish[], over: Partial<Menu> = {}): Menu {
  return { menuItems: items, restaurantName: "Some Place", ...over };
}

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
    expect(items[0]).toEqual({
      title: "Grilled Salmon",
      subtitle:
        "About 620 kcal, 43 g protein. High protein, fits your calorie target",
      action: null,
    });
  });

  it("leaves out dishes rated avoid and counts nothing for them", () => {
    const { items, allergyLeftOut } = menuToPicks(
      menu([dish({ recommendation: "avoid" }), dish({ name: "Salad" })]),
    );
    expect(items.map((i) => i.title)).toEqual(["Salad"]);
    expect(allergyLeftOut).toBe(0);
  });

  it("leaves out and counts dishes flagged for the user's allergies", () => {
    const { items, allergyLeftOut } = menuToPicks(
      menu([dish({ name: "Pad Thai" }), dish({ name: "Salad" })], {
        allergenFlags: {
          "Pad Thai": peanutMatch,
        },
      }),
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

  it("cleans and clips menu text, and leaves out a dish it cannot show", () => {
    const { items } = menuToPicks(
      menu([
        dish({ name: "  " }),
        dish({
          name: "Sal​mon‮ " + "x".repeat(200),
          recommendationReason: "r".repeat(300),
          estimatedCalories: Number.NaN,
        }),
        dish({ name: "Steak", estimatedCalories: -5 }),
      ]),
    );
    // The blank name is left out; a dish with unusable numbers shows without them.
    expect(items.map((i) => i.title.slice(0, 6))).toEqual(["Salmon", "Steak"]);
    expect(items[1].subtitle).not.toMatch(/kcal/);
    expect(items[0].title.startsWith("Salmon x")).toBe(true);
    expect([...items[0].title].length).toBeLessThanOrEqual(80);
    expect(items[0].subtitle.length).toBeLessThanOrEqual(160);
    expect(items[0].subtitle).not.toMatch(/kcal/);
  });

  it("makes a block the app can draw", () => {
    const { items } = menuToPicks(menu([dish()]));
    expect(
      suggestionListSchema.safeParse({ type: "suggestion_list", items })
        .success,
    ).toBe(true);
  });
});

describe("menuPhotoReply", () => {
  const ctx = { userId: "u1", menuScanner: true };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(storage.claimDailyAiCall).mockResolvedValue(true);
    vi.mocked(analyzeMenuPhoto).mockResolvedValue(menu([dish()]));
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
    expect(reply.payload).toBeNull();
    expect(reply.suggestions?.type).toBe("suggestion_list");
    expect(reply.suggestions?.items[0].title).toBe("Grilled Salmon");
    expect(reply.text).toBe(MENU_TEXT);
  });

  it("never repeats dish names in its line (they are model output)", async () => {
    vi.mocked(analyzeMenuPhoto).mockResolvedValue(
      menu([dish(), dish({ name: "Pad Thai" })], {
        allergenFlags: { "Pad Thai": peanutMatch },
      }),
    );
    const reply = await menuPhotoReply("BASE64", ctx);
    expect(reply.text).not.toMatch(/salmon|pad thai/i);
    expect(reply.text).toMatch(/left out 1 dish/);
  });

  it("says when nothing on the menu fits", async () => {
    vi.mocked(analyzeMenuPhoto).mockResolvedValue(
      menu([dish({ recommendation: "avoid" })]),
    );
    const reply = await menuPhotoReply("BASE64", ctx);
    expect(reply.suggestions).toBeUndefined();
    expect(reply.text).toMatch(/couldn't find a dish/);
  });

  it("asks for the plan and spends nothing without the menu scanner", async () => {
    const reply = await menuPhotoReply("BASE64", {
      ...ctx,
      menuScanner: false,
    });
    expect(storage.claimDailyAiCall).not.toHaveBeenCalled();
    expect(analyzeMenuPhoto).not.toHaveBeenCalled();
    expect(reply.text).toMatch(/menu scanner/);
  });

  it("stops at the daily menu limit without reading the menu", async () => {
    vi.mocked(storage.claimDailyAiCall).mockResolvedValue(false);
    const reply = await menuPhotoReply("BASE64", ctx);
    expect(analyzeMenuPhoto).not.toHaveBeenCalled();
    expect(reply.text).toMatch(/limit/);
  });

  it("still answers when the menu history cannot be saved", async () => {
    vi.mocked(storage.createMenuScan).mockRejectedValue(new Error("db down"));
    const reply = await menuPhotoReply("BASE64", ctx);
    expect(reply.suggestions?.items).toHaveLength(1);
  });
});
