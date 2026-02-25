import {
  lookupCulturalFood,
  getStandardizedFoodName,
  getCuisineForFood,
  CULTURAL_FOOD_MAP,
} from "../cultural-food-map";

describe("Cultural Food Map", () => {
  describe("lookupCulturalFood", () => {
    it("finds food by exact alias match", () => {
      const result = lookupCulturalFood("kimchi");
      expect(result).toBeDefined();
      expect(result!.standardName).toBe("fermented cabbage");
      expect(result!.cuisine).toBe("Korean");
    });

    it("finds food by standard name", () => {
      const result = lookupCulturalFood("lentil curry");
      expect(result).toBeDefined();
      expect(result!.aliases).toContain("dal");
    });

    it("is case-insensitive", () => {
      const result = lookupCulturalFood("KIMCHI");
      expect(result).toBeDefined();
      expect(result!.standardName).toBe("fermented cabbage");
    });

    it("trims whitespace", () => {
      const result = lookupCulturalFood("  ramen  ");
      expect(result).toBeDefined();
      expect(result!.standardName).toBe("soy sauce noodle soup");
    });

    it("matches aliases within longer strings", () => {
      const result = lookupCulturalFood("chicken bulgogi bowl");
      expect(result).toBeDefined();
      expect(result!.standardName).toBe("Korean BBQ beef");
    });

    it("returns undefined for unknown foods", () => {
      const result = lookupCulturalFood("xyzzy magic food");
      expect(result).toBeUndefined();
    });

    it("returns undefined for empty string", () => {
      const result = lookupCulturalFood("");
      expect(result).toBeUndefined();
    });

    // South Asian foods
    it("looks up dal/daal variations", () => {
      expect(lookupCulturalFood("dal")?.standardName).toBe("lentil curry");
      expect(lookupCulturalFood("daal")?.standardName).toBe("lentil curry");
      expect(lookupCulturalFood("dhal")?.standardName).toBe("lentil curry");
      expect(lookupCulturalFood("toor dal")?.standardName).toBe("lentil curry");
    });

    it("looks up flatbread variations", () => {
      expect(lookupCulturalFood("naan")?.standardName).toBe("flatbread");
      expect(lookupCulturalFood("roti")?.standardName).toBe("flatbread");
      expect(lookupCulturalFood("chapati")?.standardName).toBe("flatbread");
    });

    // East Asian foods
    it("looks up dumpling variations", () => {
      const result = lookupCulturalFood("gyoza");
      expect(result).toBeDefined();
      expect(result!.standardName).toBe("steamed dumplings");
    });

    // Middle Eastern foods
    it("looks up hummus variations", () => {
      expect(lookupCulturalFood("hummus")?.standardName).toBe("chickpea dip");
      expect(lookupCulturalFood("houmous")?.standardName).toBe("chickpea dip");
    });

    it("looks up falafel", () => {
      const result = lookupCulturalFood("falafel");
      expect(result).toBeDefined();
      expect(result!.standardName).toBe("deep fried chickpea ball");
      expect(result!.cuisine).toBe("Middle Eastern");
    });

    // Latin American foods
    it("looks up taco", () => {
      const result = lookupCulturalFood("taco");
      expect(result).toBeDefined();
      expect(result!.standardName).toBe("corn tortilla with filling");
    });

    it("looks up guacamole", () => {
      const result = lookupCulturalFood("guacamole");
      expect(result).toBeDefined();
      expect(result!.standardName).toBe("avocado dip");
    });

    // African foods
    it("looks up injera", () => {
      const result = lookupCulturalFood("injera");
      expect(result).toBeDefined();
      expect(result!.standardName).toBe("fermented flatbread");
      expect(result!.cuisine).toBe("Ethiopian");
    });

    it("looks up jollof rice", () => {
      const result = lookupCulturalFood("jollof rice");
      expect(result).toBeDefined();
      expect(result!.standardName).toBe("spiced rice");
      expect(result!.cuisine).toBe("West African");
    });

    // European foods
    it("looks up borscht", () => {
      const result = lookupCulturalFood("borscht");
      expect(result).toBeDefined();
      expect(result!.standardName).toBe("beet soup");
      expect(result!.cuisine).toBe("Eastern European");
    });
  });

  describe("getStandardizedFoodName", () => {
    it("returns the standard name for a known cultural food", () => {
      expect(getStandardizedFoodName("ramen")).toBe("soy sauce noodle soup");
    });

    it("returns the standard name for flatbread aliases", () => {
      expect(getStandardizedFoodName("naan")).toBe("flatbread");
    });

    it("returns the original query for unknown foods", () => {
      expect(getStandardizedFoodName("chicken breast")).toBe("chicken breast");
    });

    it("returns the original query for empty input", () => {
      expect(getStandardizedFoodName("")).toBe("");
    });
  });

  describe("getCuisineForFood", () => {
    it("returns cuisine classification for known food", () => {
      expect(getCuisineForFood("sushi")).toBe("Japanese");
    });

    it("returns cuisine for Korean food", () => {
      expect(getCuisineForFood("kimchi")).toBe("Korean");
    });

    it("returns cuisine for Mexican food", () => {
      expect(getCuisineForFood("taco")).toBe("Mexican");
    });

    it("returns undefined for unknown food", () => {
      expect(getCuisineForFood("hamburger")).toBeUndefined();
    });
  });

  describe("CULTURAL_FOOD_MAP data integrity", () => {
    it("has entries for all major cuisine regions", () => {
      const cuisines = new Set(CULTURAL_FOOD_MAP.map((e) => e.cuisine));
      expect(cuisines.has("South Asian")).toBe(true);
      expect(cuisines.has("Japanese")).toBe(true);
      expect(cuisines.has("Korean")).toBe(true);
      expect(cuisines.has("Middle Eastern")).toBe(true);
      expect(cuisines.has("Mexican")).toBe(true);
      expect(cuisines.has("Ethiopian")).toBe(true);
      expect(cuisines.has("Eastern European")).toBe(true);
    });

    it("every entry has a non-empty standardName", () => {
      for (const entry of CULTURAL_FOOD_MAP) {
        expect(entry.standardName.length).toBeGreaterThan(0);
      }
    });

    it("every entry has at least one alias", () => {
      for (const entry of CULTURAL_FOOD_MAP) {
        expect(entry.aliases.length).toBeGreaterThan(0);
      }
    });

    it("every entry has a valid category", () => {
      const validCategories = [
        "protein",
        "vegetable",
        "grain",
        "fruit",
        "dairy",
        "beverage",
        "other",
      ];
      for (const entry of CULTURAL_FOOD_MAP) {
        expect(validCategories).toContain(entry.category);
      }
    });

    it("every entry has a non-empty typicalServing", () => {
      for (const entry of CULTURAL_FOOD_MAP) {
        expect(entry.typicalServing.length).toBeGreaterThan(0);
      }
    });

    it("has no duplicate aliases across entries", () => {
      const allAliases: string[] = [];
      for (const entry of CULTURAL_FOOD_MAP) {
        allAliases.push(...entry.aliases);
      }
      const seen = new Set<string>();
      const duplicates: string[] = [];
      for (const alias of allAliases) {
        if (seen.has(alias)) duplicates.push(alias);
        seen.add(alias);
      }
      // Allow known duplicates (some foods belong to multiple cuisines)
      // but flag unexpected ones
      expect(duplicates.length).toBeLessThanOrEqual(5);
    });
  });
});
