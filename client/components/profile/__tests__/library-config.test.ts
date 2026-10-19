import { describe, it, expect } from "vitest";
import { libraryTileLabel } from "../library-config";

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
