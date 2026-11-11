import { describe, it, expect } from "vitest";
import {
  LIBRARY_ITEMS,
  libraryTileLabel,
  visibleLibraryItems,
} from "../library-config";
import type { LibraryCountsResponse } from "@shared/schemas/profile-hub";

describe("libraryTileLabel", () => {
  // The tile's screen-reader label said "Favourites: 1 items" — the same
  // slip the visual QA sweep flagged on the grocery list (#46).
  it("agrees the noun with the count", () => {
    expect(libraryTileLabel("Favourites", 1, false)).toBe("Favourites: 1 item");
    expect(libraryTileLabel("Saved Items", 16, false)).toBe(
      "Saved Items: 16 items",
    );
    expect(libraryTileLabel("Pantry", 0, false)).toBe("Pantry: 0 items");
  });

  it("adds the locked note for premium tiles", () => {
    expect(libraryTileLabel("Pantry", 1, true)).toBe(
      "Pantry: 1 item. Premium feature, locked",
    );
  });
});

describe("visibleLibraryItems — Weekly Reports tile", () => {
  const counts = (weeklyReports: number): LibraryCountsResponse => ({
    cookbooks: 0,
    savedItems: 0,
    scanHistory: 0,
    groceryLists: 0,
    pantryItems: 0,
    featuredRecipes: 0,
    favouriteRecipes: 0,
    weeklyReports,
  });
  const ids = (n: number) =>
    visibleLibraryItems(LIBRARY_ITEMS, counts(n)).map((i) => i.id);

  it("is hidden until the user has a report", () => {
    expect(ids(0)).not.toContain("weeklyReports");
  });

  it("shows from the first report, with no premium gate (lapsed Pro keeps it)", () => {
    expect(ids(1)).toContain("weeklyReports");
    const tile = LIBRARY_ITEMS.find((i) => i.id === "weeklyReports");
    expect(tile?.premiumKey).toBeUndefined();
  });

  it("other tiles show at zero as before", () => {
    expect(ids(0)).toContain("favourites");
    expect(ids(0)).toContain("pantry");
  });
});
