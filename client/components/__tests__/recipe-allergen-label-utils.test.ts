import { describe, it, expect } from "vitest";
import type { DerivedRecipeAllergen } from "@shared/constants/allergens";
import {
  toRecipeAllergenLabels,
  toRecipeAllergenA11ySuffix,
} from "../recipe-allergen-label-utils";

describe("recipe-allergen-label-utils", () => {
  describe("toRecipeAllergenLabels", () => {
    it("returns an empty array for null (fail-dangerous: never synthesizes a safe value)", () => {
      expect(toRecipeAllergenLabels(null)).toEqual([]);
    });

    it("returns an empty array for undefined", () => {
      expect(toRecipeAllergenLabels(undefined)).toEqual([]);
    });

    it("returns an empty array for an empty array", () => {
      expect(toRecipeAllergenLabels([])).toEqual([]);
    });

    it("maps derived allergens to id + label, preserving input order", () => {
      const result = toRecipeAllergenLabels([
        { id: "peanuts", viaDerived: false },
        { id: "tree_nuts", viaDerived: true },
      ]);

      expect(result).toEqual([
        { id: "peanuts", label: "Peanuts" },
        { id: "tree_nuts", label: "Tree Nuts" },
      ]);
    });

    // The allergens column is DB-sourced jsonb, and several consuming surfaces
    // read it through un-Zod-guarded res.json() paths — a stale row holding an
    // id outside ALLERGEN_INGREDIENT_MAP (id rename, unvalidated backfill) must
    // degrade to "not rendered", never a TypeError that unmounts the whole list
    // to the root ErrorBoundary.
    it("skips ids not present in ALLERGEN_INGREDIENT_MAP instead of crashing", () => {
      const stale = [
        { id: "peanuts", viaDerived: false },
        { id: "discontinued_id", viaDerived: false },
      ] as unknown as DerivedRecipeAllergen[];

      expect(toRecipeAllergenLabels(stale)).toEqual([
        { id: "peanuts", label: "Peanuts" },
      ]);
    });

    it("returns an empty array when every id is unknown (renders nothing — absence is never a safe signal)", () => {
      const stale = [
        { id: "discontinued_id", viaDerived: false },
      ] as unknown as DerivedRecipeAllergen[];

      expect(toRecipeAllergenLabels(stale)).toEqual([]);
    });

    // `id in MAP` would pass Object.prototype keys ("constructor" in {} is
    // true) and render "Contains: undefined" — the guard must be own-property
    // only (Object.hasOwn).
    it("skips ids that are Object.prototype keys, not own map entries", () => {
      const hostile = [
        { id: "constructor", viaDerived: false },
        { id: "__proto__", viaDerived: false },
        { id: "hasOwnProperty", viaDerived: false },
      ] as unknown as DerivedRecipeAllergen[];

      expect(toRecipeAllergenLabels(hostile)).toEqual([]);
    });
  });

  describe("toRecipeAllergenA11ySuffix", () => {
    it("returns an empty string for null/undefined/empty (fail-dangerous: no suffix, no safe signal)", () => {
      expect(toRecipeAllergenA11ySuffix(null)).toBe("");
      expect(toRecipeAllergenA11ySuffix(undefined)).toBe("");
      expect(toRecipeAllergenA11ySuffix([])).toBe("");
    });

    // Wording must match RecipeAllergenLabel's own composed label ("Contains:"),
    // so a screen-reader user hears identical phrasing whether the label is its
    // own a11y node or folded into an accessible parent card's label.
    it("builds a sentence-separated suffix matching the visible label wording", () => {
      expect(
        toRecipeAllergenA11ySuffix([
          { id: "peanuts", viaDerived: false },
          { id: "tree_nuts", viaDerived: true },
        ]),
      ).toBe(". Contains: Peanuts, Tree Nuts");
    });

    it("skips unknown ids in the suffix too", () => {
      const stale = [
        { id: "discontinued_id", viaDerived: false },
      ] as unknown as DerivedRecipeAllergen[];

      expect(toRecipeAllergenA11ySuffix(stale)).toBe("");
    });
  });
});
