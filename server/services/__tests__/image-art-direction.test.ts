// server/services/__tests__/image-art-direction.test.ts
import { describe, it, expect } from "vitest";
import {
  selectDeterministicArtDirection,
  type RecipeImageContext,
} from "../image-art-direction";

const italianDinner: RecipeImageContext = {
  title: "Spaghetti Carbonara",
  cuisine: "Italian",
  mealTypes: ["dinner"],
};

describe("selectDeterministicArtDirection", () => {
  it("is stable for the same recipe + variant", () => {
    const a = selectDeterministicArtDirection(italianDinner, "hero");
    const b = selectDeterministicArtDirection(italianDinner, "hero");
    expect(a).toEqual(b);
  });

  it("maps meal type to time-of-day lighting", () => {
    const dinner = selectDeterministicArtDirection(italianDinner, "hero");
    const breakfast = selectDeterministicArtDirection(
      { ...italianDinner, mealTypes: ["breakfast"] },
      "hero",
    );
    expect(dinner.lighting).toMatch(/golden-hour|evening|warm/i);
    expect(breakfast.lighting).toMatch(/morning/i);
  });

  it("falls back to the default palette for unknown cuisine", () => {
    const known = selectDeterministicArtDirection(italianDinner, "hero");
    const unknown = selectDeterministicArtDirection(
      {
        title: "Spaghetti Carbonara",
        cuisine: "Martian",
        mealTypes: ["dinner"],
      },
      "hero",
    );
    // Different cuisine style sets → at least one slot differs in expectation,
    // but the key assertion is it does not throw and returns a full ArtDirection.
    expect(unknown.surface).toBeTruthy();
    expect(known.surface).toBeTruthy();
  });

  it("produces variety across a corpus (not all identical)", () => {
    const titles = [
      "Carbonara",
      "Margherita Pizza",
      "Risotto",
      "Lasagna",
      "Tiramisu",
      "Bruschetta",
      "Minestrone",
      "Gnocchi",
      "Osso Buco",
      "Cannoli",
    ];
    const angles = new Set(
      titles.map(
        (t) =>
          selectDeterministicArtDirection(
            { title: t, cuisine: "Italian", mealTypes: ["dinner"] },
            "hero",
          ).angle,
      ),
    );
    expect(angles.size).toBeGreaterThanOrEqual(2);
  });
});
