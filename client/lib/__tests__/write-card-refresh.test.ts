import { describe, it, expect } from "vitest";
import {
  arrivedSavedRefreshKeys,
  writeCardRefreshKeys,
} from "../write-card-refresh";

describe("writeCardRefreshKeys", () => {
  it("a food card refreshes the diary and the day's totals", () => {
    expect(writeCardRefreshKeys("food")).toEqual([
      ["/api/scanned-items"],
      ["/api/daily-summary"],
      ["/api/daily-budget"],
    ]);
  });

  it("a grocery card refreshes the grocery lists", () => {
    expect(writeCardRefreshKeys("grocery")).toEqual([
      ["/api/meal-plan/grocery-lists"],
    ]);
  });

  it("a plan card refreshes the plan, its copied recipes, the day's budget and the grocery lists", () => {
    expect(writeCardRefreshKeys("plan")).toEqual([
      ["/api/meal-plan"],
      ["/api/meal-plan/recipes"],
      ["/api/recipes/browse"],
      ["/api/daily-budget"],
      ["/api/meal-plan/grocery-lists"],
    ]);
  });

  it("a pantry card refreshes the pantry and its expiring list", () => {
    expect(writeCardRefreshKeys("pantry")).toEqual([
      ["/api/pantry"],
      ["/api/pantry/expiring"],
    ]);
  });

  it("a goals card refreshes the goals and the day's totals", () => {
    expect(writeCardRefreshKeys("goals")).toEqual([
      ["/api/goals"],
      ["/api/daily-summary"],
      ["/api/daily-budget"],
    ]);
  });

  it("an allergy card refreshes the dietary profile", () => {
    expect(writeCardRefreshKeys("allergy")).toEqual([
      ["/api/user/dietary-profile"],
    ]);
  });

  it("an unknown kind refreshes nothing extra", () => {
    expect(writeCardRefreshKeys(undefined)).toEqual([]);
  });
});

// Coach roadmap T2: a reply can arrive with a food log already applied.
describe("arrivedSavedRefreshKeys", () => {
  const card = (over: Record<string, unknown>) =>
    ({
      type: "write_card",
      cardId: "6f1c2b9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f",
      kind: "food",
      payload: { items: [], mealType: "breakfast", day: "today" },
      status: "saved",
      ...over,
    }) as Parameters<typeof arrivedSavedRefreshKeys>[0][number];

  it("refreshes the diary and totals for a log applied at once", () => {
    expect(arrivedSavedRefreshKeys([card({ loggedAtOnce: true })])).toEqual(
      writeCardRefreshKeys("food"),
    );
  });

  it("nothing for a card still waiting on Save, or other blocks", () => {
    expect(arrivedSavedRefreshKeys([card({ status: "live" })])).toEqual([]);
    expect(
      arrivedSavedRefreshKeys([{ type: "quick_replies", options: [] }]),
    ).toEqual([]);
    expect(arrivedSavedRefreshKeys([])).toEqual([]);
  });
});
