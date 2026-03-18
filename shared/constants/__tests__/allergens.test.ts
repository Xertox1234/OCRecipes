import {
  allergenIds,
  allergenIdSchema,
  allergySeveritySchema,
  ALLERGEN_INGREDIENT_MAP,
  detectAllergens,
  _testInternals,
  type AllergySeverity,
} from "../allergens";

const { normalizeAllergenId, ingredientContainsKeyword } = _testInternals;

// ============================================================================
// ALLERGEN DEFINITIONS
// ============================================================================

describe("Allergen Constants", () => {
  describe("allergenIdSchema", () => {
    it("accepts all valid allergen IDs", () => {
      for (const id of allergenIds) {
        expect(allergenIdSchema.safeParse(id).success).toBe(true);
      }
    });

    it("rejects invalid allergen ID", () => {
      expect(allergenIdSchema.safeParse("invalid").success).toBe(false);
    });
  });

  describe("allergySeveritySchema", () => {
    it("accepts valid severities", () => {
      for (const s of ["mild", "moderate", "severe"]) {
        expect(allergySeveritySchema.safeParse(s).success).toBe(true);
      }
    });

    it("rejects invalid severity", () => {
      expect(allergySeveritySchema.safeParse("extreme").success).toBe(false);
    });
  });

  describe("ALLERGEN_INGREDIENT_MAP", () => {
    it("has an entry for every allergen ID", () => {
      for (const id of allergenIds) {
        expect(ALLERGEN_INGREDIENT_MAP[id]).toBeDefined();
        expect(ALLERGEN_INGREDIENT_MAP[id].id).toBe(id);
      }
    });

    it("each allergen has at least 5 direct ingredients", () => {
      for (const id of allergenIds) {
        expect(
          ALLERGEN_INGREDIENT_MAP[id].directIngredients.length,
        ).toBeGreaterThanOrEqual(5);
      }
    });

    it("each allergen has at least 3 derived ingredients", () => {
      for (const id of allergenIds) {
        expect(
          ALLERGEN_INGREDIENT_MAP[id].derivedIngredients.length,
        ).toBeGreaterThanOrEqual(3);
      }
    });

    it("all ingredient keywords are lowercase", () => {
      for (const id of allergenIds) {
        const def = ALLERGEN_INGREDIENT_MAP[id];
        for (const kw of [
          ...def.directIngredients,
          ...def.derivedIngredients,
        ]) {
          expect(kw).toBe(kw.toLowerCase());
        }
      }
    });

    it("has no duplicate keywords within an allergen", () => {
      for (const id of allergenIds) {
        const def = ALLERGEN_INGREDIENT_MAP[id];
        const all = [...def.directIngredients, ...def.derivedIngredients];
        const unique = new Set(all);
        expect(unique.size).toBe(all.length);
      }
    });
  });
});

// ============================================================================
// NORMALISE ALLERGEN ID
// ============================================================================

describe("normalizeAllergenId", () => {
  it("maps canonical IDs directly", () => {
    expect(normalizeAllergenId("peanuts")).toBe("peanuts");
    expect(normalizeAllergenId("tree_nuts")).toBe("tree_nuts");
    expect(normalizeAllergenId("milk")).toBe("milk");
    expect(normalizeAllergenId("sesame")).toBe("sesame");
  });

  it("handles common label variants", () => {
    expect(normalizeAllergenId("Dairy/Milk")).toBe("milk");
    expect(normalizeAllergenId("Wheat/Gluten")).toBe("wheat");
    expect(normalizeAllergenId("peanut")).toBe("peanuts");
    expect(normalizeAllergenId("Tree Nuts")).toBe("tree_nuts");
    expect(normalizeAllergenId("Egg")).toBe("eggs");
  });

  it("is case-insensitive", () => {
    expect(normalizeAllergenId("PEANUTS")).toBe("peanuts");
    expect(normalizeAllergenId("Milk")).toBe("milk");
  });

  it("returns null for unrecognized names", () => {
    expect(normalizeAllergenId("kiwi")).toBeNull();
    expect(normalizeAllergenId("")).toBeNull();
  });
});

// ============================================================================
// WORD BOUNDARY MATCHING
// ============================================================================

describe("ingredientContainsKeyword", () => {
  it("matches exact ingredient name", () => {
    expect(ingredientContainsKeyword("butter", "butter")).toBe(true);
    expect(ingredientContainsKeyword("milk", "milk")).toBe(true);
  });

  it("matches keyword at word boundaries", () => {
    expect(ingredientContainsKeyword("unsalted butter", "butter")).toBe(true);
    expect(ingredientContainsKeyword("whole milk, 2%", "milk")).toBe(true);
    expect(
      ingredientContainsKeyword("cheddar cheese, shredded", "cheese"),
    ).toBe(true);
  });

  it("does NOT match keyword within another word", () => {
    // "cod" should not match "avocado"
    expect(ingredientContainsKeyword("avocado", "cod")).toBe(false);
    // "egg" should not match "eggplant" — but this is tricky because "egg" appears
    // at the start. The boundary check handles this because "eggplant" has no boundary after "egg".
  });

  it("matches multi-word keywords via simple substring", () => {
    expect(
      ingredientContainsKeyword(
        "organic peanut butter, crunchy",
        "peanut butter",
      ),
    ).toBe(true);
    expect(ingredientContainsKeyword("lite soy sauce", "soy sauce")).toBe(true);
  });

  it("does NOT match unrelated multi-word combos", () => {
    expect(ingredientContainsKeyword("almond extract", "almond milk")).toBe(
      false,
    );
  });
});

// ============================================================================
// DETECT ALLERGENS
// ============================================================================

describe("detectAllergens", () => {
  const peanutSevere: { name: string; severity: AllergySeverity } = {
    name: "peanuts",
    severity: "severe",
  };
  const dairyMild: { name: string; severity: AllergySeverity } = {
    name: "milk",
    severity: "mild",
  };
  const dairyModerate: { name: string; severity: AllergySeverity } = {
    name: "milk",
    severity: "moderate",
  };
  const wheatSevere: { name: string; severity: AllergySeverity } = {
    name: "wheat",
    severity: "severe",
  };

  it("returns empty for no allergies", () => {
    expect(detectAllergens(["butter", "flour"], [])).toEqual([]);
  });

  it("returns empty for no ingredients", () => {
    expect(detectAllergens([], [peanutSevere])).toEqual([]);
  });

  it("detects direct peanut allergen", () => {
    const matches = detectAllergens(["peanut butter", "rice"], [peanutSevere]);
    expect(matches).toHaveLength(1);
    expect(matches[0].allergenId).toBe("peanuts");
    expect(matches[0].ingredientName).toBe("peanut butter");
    expect(matches[0].severity).toBe("severe");
    expect(matches[0].isDerived).toBe(false);
  });

  it("mild severity only flags direct dairy ingredients", () => {
    const matches = detectAllergens(
      ["whole milk", "whey protein", "rice"],
      [dairyMild],
    );
    // "whole milk" matches direct "milk", "whey protein" is derived — should not match at mild
    expect(matches).toHaveLength(1);
    expect(matches[0].ingredientName).toBe("whole milk");
  });

  it("moderate severity flags both direct and derived dairy", () => {
    const matches = detectAllergens(
      ["whole milk", "whey protein", "rice"],
      [dairyModerate],
    );
    expect(matches).toHaveLength(2);
    const names = matches.map((m) => m.ingredientName);
    expect(names).toContain("whole milk");
    expect(names).toContain("whey protein");
  });

  it("marks derived matches correctly", () => {
    const matches = detectAllergens(["casein powder"], [dairyModerate]);
    expect(matches).toHaveLength(1);
    expect(matches[0].isDerived).toBe(true);
  });

  it("handles multiple allergies simultaneously", () => {
    const matches = detectAllergens(
      ["peanut butter", "whole milk", "rice", "bread"],
      [peanutSevere, dairyMild, wheatSevere],
    );
    expect(matches.length).toBeGreaterThanOrEqual(3);
    const allergenIds = matches.map((m) => m.allergenId);
    expect(allergenIds).toContain("peanuts");
    expect(allergenIds).toContain("milk");
    expect(allergenIds).toContain("wheat");
  });

  it("is case-insensitive on ingredient names", () => {
    const matches = detectAllergens(["PEANUT BUTTER"], [peanutSevere]);
    expect(matches).toHaveLength(1);
  });

  it("does not false-positive on unrelated ingredients", () => {
    const matches = detectAllergens(
      ["chicken breast", "broccoli", "olive oil", "garlic"],
      [peanutSevere, dairyMild, wheatSevere],
    );
    expect(matches).toEqual([]);
  });

  it("handles profile-style allergy names (Dairy/Milk)", () => {
    const matches = detectAllergens(
      ["cheddar cheese"],
      [{ name: "Dairy/Milk", severity: "mild" }],
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].allergenId).toBe("milk");
  });

  it("detects wheat-containing ingredients at severe level", () => {
    const matches = detectAllergens(["vital wheat gluten"], [wheatSevere]);
    expect(matches).toHaveLength(1);
    expect(matches[0].allergenId).toBe("wheat");
    // "vital wheat gluten" matches on the "wheat" direct keyword first
    // (word-boundary match finds "wheat" inside the phrase), which is correct
    // — the ingredient IS flagged regardless of which keyword matched.
    expect(matches[0].ingredientName).toBe("vital wheat gluten");
  });
});
