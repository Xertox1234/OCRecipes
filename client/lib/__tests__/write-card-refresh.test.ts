import { describe, it, expect } from "vitest";
import {
  arrivedSavedRefreshKeys,
  loggedAtOnceReceipt,
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

  it("a reminders card refreshes the profile the Coach Reminders screen reads (A3)", () => {
    expect(writeCardRefreshKeys("reminders")).toEqual([
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

// Mobile review: on iOS a card that arrives saved is silent, so the reply's
// finish announcement carries its receipt.
describe("loggedAtOnceReceipt", () => {
  const card = (over: Record<string, unknown>) =>
    ({
      type: "write_card",
      cardId: "6f1c2b9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f",
      kind: "food",
      payload: { items: [], mealType: "breakfast", day: "today" },
      status: "saved",
      receipt: "✓ Logged to Breakfast · 144 cal",
      ...over,
    }) as Parameters<typeof loggedAtOnceReceipt>[0][number];

  it("gives the receipt, without the tick, for a log applied at once", () => {
    expect(loggedAtOnceReceipt([card({ loggedAtOnce: true })])).toBe(
      "Logged to Breakfast · 144 cal. Undo is on the card.",
    );
  });

  it("is null for any other card", () => {
    expect(loggedAtOnceReceipt([card({})])).toBeNull();
    expect(
      loggedAtOnceReceipt([card({ loggedAtOnce: true, status: "live" })]),
    ).toBeNull();
    expect(loggedAtOnceReceipt([])).toBeNull();
  });
});
