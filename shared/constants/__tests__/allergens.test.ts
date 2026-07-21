import {
  allergenIds,
  allergenIdSchema,
  allergySeveritySchema,
  ALLERGEN_INGREDIENT_MAP,
  detectAllergens,
  deriveRecipeAllergens,
  isRecipeSafeForAllergies,
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
// PLANT-SUBSTITUTE GUARD (bare dairy/wheat keyword preceded by a plant base)
// ============================================================================

describe("ingredientContainsKeyword — plant-substitute guard", () => {
  it("does NOT match bare dairy keywords inside plant milks/creams/butters", () => {
    const cases: [string, string][] = [
      ["almond milk", "milk"],
      ["unsweetened oat milk", "milk"],
      ["soy milk", "milk"],
      ["coconut milk", "milk"],
      ["cashew milk", "milk"],
      ["rice milk", "milk"],
      ["oat-milk", "milk"],
      ["coconut cream", "cream"],
      ["peanut butter", "butter"],
      ["almond butter", "butter"],
      ["sunflower butter", "butter"],
      ["cocoa butter", "butter"],
    ];
    for (const [ingredient, keyword] of cases) {
      expect(ingredientContainsKeyword(ingredient, keyword)).toBe(false);
    }
  });

  it("does NOT match bare 'flour' inside gluten-free substitute flours", () => {
    const flours = [
      "almond flour",
      "coconut flour",
      "rice flour",
      "chickpea flour",
      "garbanzo flour",
      "oat flour",
      "corn flour",
      "tapioca flour",
      "cassava flour",
      "buckwheat flour",
    ];
    for (const ingredient of flours) {
      expect(ingredientContainsKeyword(ingredient, "flour")).toBe(false);
    }
  });

  it("STILL matches bare dairy/wheat staples (must not under-flag)", () => {
    const mustMatch: [string, string][] = [
      ["milk", "milk"],
      ["cream", "cream"],
      ["butter", "butter"],
      ["flour", "flour"],
      ["whole milk", "milk"],
      ["skim milk", "milk"],
      ["ice cream", "cream"],
      ["heavy cream", "cream"],
      ["whipped cream", "cream"],
      ["sour cream", "cream"],
      ["unsalted butter", "butter"],
      ["cream cheese", "cream"],
      ["wheat flour", "flour"],
      ["white flour", "flour"],
      ["bread flour", "flour"],
      ["all-purpose flour", "flour"],
      ["whole wheat flour", "flour"],
    ];
    for (const [ingredient, keyword] of mustMatch) {
      expect(ingredientContainsKeyword(ingredient, keyword)).toBe(true);
    }
  });

  it("'buttermilk' still flags milk via its explicit keyword (one word)", () => {
    expect(ingredientContainsKeyword("buttermilk", "buttermilk")).toBe(true);
  });

  it("does NOT match bare dairy/wheat PLURAL keywords inside plant-substitute plurals", () => {
    // The guard-sensitive base words (milk/cream/butter/flour) gained explicit
    // plural keywords (milks/creams/butters/flours). Each plural must ALSO be a
    // MODIFIER_SENSITIVE_KEYWORD so the plant-substitute suppression fires — a
    // plural in the map but not the guard set would let "almond milks" flag dairy.
    const cases: [string, string][] = [
      ["almond milks", "milks"],
      ["unsweetened oat milks", "milks"],
      ["coconut creams", "creams"],
      ["cashew creams", "creams"],
      ["shea butters", "butters"],
      ["sunflower butters", "butters"],
      ["cocoa butters", "butters"],
      ["almond flours", "flours"],
      ["oat flours", "flours"],
      ["rice flours", "flours"],
      ["cassava flours", "flours"],
    ];
    for (const [ingredient, keyword] of cases) {
      expect(ingredientContainsKeyword(ingredient, keyword)).toBe(false);
    }
  });

  it("STILL matches genuine dairy/wheat plural staples (must not under-flag)", () => {
    // The plural guard must not over-suppress real dairy/wheat plurals. "wheat
    // flours" MUST flag — wheat is a gluten grain, deliberately excluded from the
    // substitute-modifier list.
    const mustMatch: [string, string][] = [
      ["milks", "milks"],
      ["fresh creams", "creams"],
      ["cultured butters", "butters"],
      ["enriched flours", "flours"],
      ["wheat flours", "flours"],
    ];
    for (const [ingredient, keyword] of mustMatch) {
      expect(ingredientContainsKeyword(ingredient, keyword)).toBe(true);
    }
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

  it("matches the plural 'peanuts' in ingredient text (regression: keyword was singular-only)", () => {
    const matches = detectAllergens(
      ["roasted peanuts"],
      [{ name: "peanuts", severity: "severe" }],
    );
    expect(matches.some((m) => m.allergenId === "peanuts")).toBe(true);
  });

  it("matches common plural ingredient-text forms across allergens (regression: single-word keyword was singular-only)", () => {
    // Each of these is a single-word keyword (e.g. "almond") gaining an explicit
    // plural entry ("almonds") — the actual bug: the word-boundary regex requires
    // a boundary character immediately after the keyword, so "almond" alone never
    // matched "almonds". Covers every allergen (peanuts, tree_nuts, milk, eggs,
    // wheat, soy, fish, shellfish); sesame's *single-word* keyword ("sesame")
    // already had no plural gap — see the multi-word test below for that tier.
    const cases: [string, string][] = [
      ["a bag of roasted almonds", "tree_nuts"],
      ["chopped cashews", "tree_nuts"],
      ["candied walnuts", "tree_nuts"],
      ["toasted hazelnuts", "tree_nuts"],
      ["roasted groundnuts", "peanuts"],
      ["ground soybeans", "soy"],
      ["homemade omelettes", "eggs"],
      ["crushed crackers", "wheat"],
      ["canned sardines", "fish"],
      ["steamed mussels", "shellfish"],
      ["shredded cheeses", "milk"],
    ];
    for (const [ingredient, allergenId] of cases) {
      const matches = detectAllergens(
        [ingredient],
        [{ name: allergenId, severity: "severe" }],
      );
      expect(matches.some((m) => m.allergenId === allergenId)).toBe(true);
    }
  });

  it("matches plural forms of multi-word keywords (already worked pre-fix via substring match — verified per AC)", () => {
    // Multi-word keywords go through `ingredientContainsKeyword`'s simple
    // `.includes()` path, not the word-boundary regex — so "sesame seed" was
    // ALREADY a substring of "sesame seeds" before this change (same for "egg
    // white(s)"). Kept as an explicit assertion because the todo's Acceptance
    // Criteria names "sesame seeds" as a required verification case, but this
    // is confirmation, not a regression fix — see the single-word test above
    // for the cases that actually depended on this change.
    const cases: [string, string][] = [
      ["a sprinkle of sesame seeds", "sesame"],
      ["whipped egg whites", "eggs"],
    ];
    for (const [ingredient, allergenId] of cases) {
      const matches = detectAllergens(
        [ingredient],
        [{ name: allergenId, severity: "severe" }],
      );
      expect(matches.some((m) => m.allergenId === allergenId)).toBe(true);
    }
  });

  it("matches guard-sensitive dairy/wheat plural base words WITHOUT weakening the plant-substitute guard", () => {
    // Genuine dairy/wheat plurals must flag. Each string is caught ONLY by the
    // new plural keyword — text a multi-word keyword already matches ("heavy
    // creams" → "heavy cream", "ice creams" → "ice cream", "almond butters" →
    // tree-nut "almond butter") would pass pre-change and prove nothing.
    const positives: [string, string][] = [
      ["cultured milks", "milk"],
      ["fresh creams", "milk"],
      ["cultured butters", "milk"],
      ["enriched flours", "wheat"],
    ];
    for (const [ingredient, allergenId] of positives) {
      const matches = detectAllergens(
        [ingredient],
        [{ name: allergenId, severity: "severe" }],
      );
      expect(matches.some((m) => m.allergenId === allergenId)).toBe(true);
    }

    // Plant-substitute plurals must NOT flag dairy/wheat — the guard still fires.
    const suppressed: [string, string][] = [
      ["almond milks", "milk"],
      ["coconut creams", "milk"],
      ["shea butters", "milk"],
      ["oat flours", "wheat"],
    ];
    for (const [ingredient, allergenId] of suppressed) {
      const matches = detectAllergens(
        [ingredient],
        [{ name: allergenId, severity: "severe" }],
      );
      expect(matches.some((m) => m.allergenId === allergenId)).toBe(false);
    }
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

// ============================================================================
// deriveRecipeAllergens — recipe-side allergen derivation
// ============================================================================

describe("deriveRecipeAllergens", () => {
  it("returns an empty array for no ingredients", () => {
    expect(deriveRecipeAllergens([])).toEqual([]);
  });

  it("flags a direct-tier hit as viaDerived: false", () => {
    const result = deriveRecipeAllergens(["peanut butter", "bread"]);
    const peanuts = result.find((a) => a.id === "peanuts");
    expect(peanuts).toEqual({ id: "peanuts", viaDerived: false });
  });

  it("flags a derived-only hit as viaDerived: true", () => {
    // "casein" is a derived-tier milk keyword; no direct milk keyword present.
    const result = deriveRecipeAllergens(["casein", "sugar"]);
    const milk = result.find((a) => a.id === "milk");
    expect(milk).toEqual({ id: "milk", viaDerived: true });
  });

  it("direct wins when both tiers match the same allergen", () => {
    // "cheese" is direct-tier milk; "whey" is derived-tier milk.
    const result = deriveRecipeAllergens(["cheese", "whey"]);
    const milk = result.find((a) => a.id === "milk");
    expect(milk).toEqual({ id: "milk", viaDerived: false });
  });

  it("derives multiple distinct allergens", () => {
    const result = deriveRecipeAllergens(["cashew", "egg", "shrimp"]);
    const ids = result.map((a) => a.id).sort();
    expect(ids).toEqual(["eggs", "shellfish", "tree_nuts"]);
  });

  it("returns an empty array when no allergen keywords match", () => {
    expect(deriveRecipeAllergens(["broccoli", "olive oil"])).toEqual([]);
  });

  it("plant substitutes derive only their OWN allergen, not the substituted one", () => {
    // almond milk → tree_nut (via "almond"), NOT milk
    const almondMilk = deriveRecipeAllergens(["almond milk"]).map((a) => a.id);
    expect(almondMilk).toContain("tree_nuts");
    expect(almondMilk).not.toContain("milk");

    // soy milk → soy, NOT milk
    const soyMilk = deriveRecipeAllergens(["soy milk"]).map((a) => a.id);
    expect(soyMilk).toContain("soy");
    expect(soyMilk).not.toContain("milk");

    // peanut butter → peanuts, NOT milk
    const peanutButter = deriveRecipeAllergens(["peanut butter"]).map(
      (a) => a.id,
    );
    expect(peanutButter).toContain("peanuts");
    expect(peanutButter).not.toContain("milk");

    // coconut flour → no allergens (coconut isn't tracked here), NOT wheat
    expect(deriveRecipeAllergens(["coconut flour"])).toEqual([]);
  });

  it("real dairy/wheat staples still derive their allergen", () => {
    expect(deriveRecipeAllergens(["whole milk"]).map((a) => a.id)).toContain(
      "milk",
    );
    expect(deriveRecipeAllergens(["wheat flour"]).map((a) => a.id)).toContain(
      "wheat",
    );
    expect(deriveRecipeAllergens(["butter"]).map((a) => a.id)).toContain(
      "milk",
    );
  });

  it("derives allergens from plural ingredient-text forms (regression: single-word keyword was singular-only)", () => {
    // Same single-word-keyword bug as the detectAllergens test above — see that
    // test's comment for why sesame's bare keyword isn't here. Each ingredient
    // string is isolated to just the keyword under test (no other allergen
    // keyword present) so the assertion actually depends on the plural addition
    // — e.g. NOT "whole wheat crackers", which would pass via the pre-existing
    // "wheat" keyword alone regardless of whether "crackers" matched.
    const cases: [string, string][] = [
      ["roasted almonds", "tree_nuts"],
      ["chopped cashews", "tree_nuts"],
      ["candied walnuts", "tree_nuts"],
      ["toasted hazelnuts", "tree_nuts"],
      ["roasted groundnuts", "peanuts"],
      ["ground soybeans", "soy"],
      ["homemade omelettes", "eggs"],
      ["crushed crackers", "wheat"],
      ["canned sardines", "fish"],
      ["steamed mussels", "shellfish"],
      ["shredded cheeses", "milk"],
    ];
    for (const [ingredient, allergenId] of cases) {
      const ids = deriveRecipeAllergens([ingredient]).map((a) => a.id);
      expect(ids).toContain(allergenId);
    }
  });

  it("derives allergens from plural forms of multi-word keywords (already worked pre-fix via substring match — verified per AC)", () => {
    // Confirmation, not a regression fix — see the detectAllergens test's
    // comment on the equivalent multi-word case for the full explanation.
    const cases: [string, string][] = [
      ["toasted sesame seeds", "sesame"],
      ["whipped egg whites", "eggs"],
    ];
    for (const [ingredient, allergenId] of cases) {
      const ids = deriveRecipeAllergens([ingredient]).map((a) => a.id);
      expect(ids).toContain(allergenId);
    }
  });

  it("derives guard-sensitive dairy/wheat plural base words, keeping the plant-substitute guard", () => {
    // Recipe-side mirror of the detectAllergens plural guard test — both paths
    // share `ingredientContainsKeyword`, but the AC requires proving both suites.
    // Genuine dairy/wheat plurals derive their allergen:
    expect(
      deriveRecipeAllergens(["cultured milks"]).map((a) => a.id),
    ).toContain("milk");
    expect(deriveRecipeAllergens(["fresh creams"]).map((a) => a.id)).toContain(
      "milk",
    );
    expect(
      deriveRecipeAllergens(["cultured butters"]).map((a) => a.id),
    ).toContain("milk");
    expect(
      deriveRecipeAllergens(["enriched flours"]).map((a) => a.id),
    ).toContain("wheat");

    // Plant-substitute plurals derive only their OWN allergen, not dairy/wheat:
    const almondMilks = deriveRecipeAllergens(["almond milks"]).map(
      (a) => a.id,
    );
    expect(almondMilks).toContain("tree_nuts");
    expect(almondMilks).not.toContain("milk");
    expect(
      deriveRecipeAllergens(["coconut creams"]).map((a) => a.id),
    ).not.toContain("milk");
    expect(
      deriveRecipeAllergens(["oat flours"]).map((a) => a.id),
    ).not.toContain("wheat");
  });
});

// ============================================================================
// isRecipeSafeForAllergies — recipe-side safety gate
// ============================================================================

describe("isRecipeSafeForAllergies", () => {
  it("is safe when the user has no allergies", () => {
    expect(
      isRecipeSafeForAllergies([{ id: "peanuts", viaDerived: false }], []),
    ).toBe(true);
  });

  it("is safe when the recipe carries no allergens", () => {
    expect(
      isRecipeSafeForAllergies([], [{ name: "peanuts", severity: "severe" }]),
    ).toBe(true);
  });

  it("is unsafe when the recipe's allergens are null (not yet derived)", () => {
    expect(
      isRecipeSafeForAllergies(null, [{ name: "peanuts", severity: "mild" }]),
    ).toBe(false);
  });

  it("is safe for a null-allergen recipe when the user has no allergies", () => {
    expect(isRecipeSafeForAllergies(null, [])).toBe(true);
  });

  it("is unsafe for a direct-tier hit even at mild severity", () => {
    expect(
      isRecipeSafeForAllergies(
        [{ id: "peanuts", viaDerived: false }],
        [{ name: "peanuts", severity: "mild" }],
      ),
    ).toBe(false);
  });

  it("is safe for a derived-only hit at mild severity", () => {
    expect(
      isRecipeSafeForAllergies(
        [{ id: "milk", viaDerived: true }],
        [{ name: "milk", severity: "mild" }],
      ),
    ).toBe(true);
  });

  it("is unsafe for a derived-only hit at moderate severity", () => {
    expect(
      isRecipeSafeForAllergies(
        [{ id: "milk", viaDerived: true }],
        [{ name: "milk", severity: "moderate" }],
      ),
    ).toBe(false);
  });

  it("is unsafe for a derived-only hit at severe severity", () => {
    expect(
      isRecipeSafeForAllergies(
        [{ id: "milk", viaDerived: true }],
        [{ name: "milk", severity: "severe" }],
      ),
    ).toBe(false);
  });

  it("is safe when the recipe's allergen is not one the user has", () => {
    expect(
      isRecipeSafeForAllergies(
        [{ id: "soy", viaDerived: false }],
        [{ name: "peanuts", severity: "severe" }],
      ),
    ).toBe(true);
  });

  it("resolves profile-style allergy names (Dairy/Milk)", () => {
    expect(
      isRecipeSafeForAllergies(
        [{ id: "milk", viaDerived: false }],
        [{ name: "Dairy/Milk", severity: "mild" }],
      ),
    ).toBe(false);
  });
});
