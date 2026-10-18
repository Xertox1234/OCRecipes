import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { allergenIds } from "@shared/constants/allergens";
import { RECIPE_ATTRIBUTE_LABELS } from "@shared/constants/recipe-attributes";
import {
  ALLERGEN_ICON,
  RECIPE_ATTRIBUTE_VISUALS,
} from "../recipe-attribute-visuals";

// The real glyph map. Resolved through Node, not Vite: vitest aliases
// `@expo/vector-icons` to the render-test mock, which has no glyph map.
const glyphs: Record<string, number> = JSON.parse(
  readFileSync(
    createRequire(import.meta.url).resolve(
      "@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/MaterialCommunityIcons.json",
    ),
    "utf8",
  ),
);

describe("recipe attribute visuals", () => {
  it("has a visual for every attribute", () => {
    expect(Object.keys(RECIPE_ATTRIBUTE_VISUALS).sort()).toEqual(
      Object.keys(RECIPE_ATTRIBUTE_LABELS).sort(),
    );
  });

  it("has an icon for every allergen", () => {
    expect(Object.keys(ALLERGEN_ICON).sort()).toEqual([...allergenIds].sort());
  });

  // A typo in an icon name renders a "?" box on the phone and passes tsc only
  // if the name happens to exist — check the real glyph map instead.
  it.each([
    ...Object.values(RECIPE_ATTRIBUTE_VISUALS).map((v) => v.icon),
    ...Object.values(ALLERGEN_ICON),
  ])("%s exists in MaterialCommunityIcons", (icon) => {
    expect(Object.hasOwn(glyphs, icon)).toBe(true);
  });
});
