import { describe, it, expect } from "vitest";
import { writeCardRefreshKeys } from "../write-card-refresh";

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
