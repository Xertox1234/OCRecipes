import { describe, it, expect } from "vitest";
import {
  ALLERGEN_INGREDIENT_MAP,
  allergenIds,
  deriveRecipeAllergens,
  detectAllergens,
  firstMatchPerIngredient,
  ingredientContainsKeyword,
  isBlockingAllergenMatch,
  isRecipeSafeForAllergies,
  type AllergenId,
  type AllergySeverity,
} from "../allergens";

/** The recipe-level entry for one allergen, or undefined when not flagged. */
function entryFor(ingredient: string, id: AllergenId) {
  return deriveRecipeAllergens([ingredient]).find((a) => a.id === id);
}

// Foods that MAY carry the allergen depending on recipe or brand (owner
// ruling 2026-11-15): warn, never assert.
const POSSIBLE: Record<AllergenId, string[]> = {
  wheat: [
    "sponge cake",
    "2 cakes",
    "crushed cookies",
    "cookie",
    "muffin",
    "muffins",
    "biscuit",
    "biscuits",
    "cereal",
    "cereals",
    "granola",
    "gravy",
    "stuffing",
    "toast",
    "sandwich",
    "sandwiches",
    "spring rolls",
    "pancake mix",
    "pancakes",
    "waffle",
    "waffles",
    "crepe",
    "crepes",
    "wafer",
    "wafers",
    "ice cream cone",
    "cones",
    "pie shell",
    "tart shell",
    "breading",
    "breaded chicken",
    "roux",
    "soba",
    "lo mein",
    "vermicelli",
    "graham",
    "rusk",
    "rusks",
    "batter",
    "tempura",
    "meatball",
    "meatballs",
    "meatloaf",
    "sausage",
    "sausages",
    "bouillon",
    "stock cube",
    "brownie",
    "brownies",
    "licorice",
    "surimi",
    "miso",
    "worcestershire sauce",
    "hoisin sauce",
    "oyster sauce",
    "cream of mushroom soup",
    "veggie burger",
    "fish sticks",
    "chicken nuggets",
  ],
  milk: [
    "dark chocolate",
    "caramel",
    "pudding",
    "frosting",
    "ranch dressing",
    "nougat",
    "sherbet",
    "whipped topping",
    "coffee creamer",
    "margarine",
    "toffee",
    "fudge",
    "mashed potatoes",
    "chowder",
    "potato gratin",
    "pizza",
    "hot chocolate",
    "cocoa mix",
    "protein powder",
    "naan",
    "brioche",
    "croissant",
    "croissants",
    "pancake mix",
    "biscuits",
    "cake",
    "caesar dressing",
    "white sauce",
  ],
  eggs: [
    "marshmallow",
    "marshmallows",
    "fresh pasta",
    "noodles",
    "caesar dressing",
    "brioche",
    "challah",
    "cake",
    "cookies",
    "muffins",
    "pancakes",
    "waffles",
    "crepes",
    "meatballs",
    "meatloaf",
    "batter",
    "breaded fish",
    "tempura",
    "mousse",
    "ice cream",
    "nougat",
    "macaroons",
    "pudding",
    "frosting",
    "pretzels",
    "doughnuts",
    "donut",
    "ramen",
    "pad thai",
    "fried rice",
    "surimi",
    "ranch dressing",
  ],
  tree_nuts: [
    "pesto",
    "granola",
    "muesli",
    "trail mix",
    "amaretto",
    "macaroon",
    "mortadella",
    "mole",
    "biscotti",
    "energy bars",
    "korma",
    "pilaf",
    "fruitcake",
    "brownies",
    "chocolate spread",
    "cereal",
    "cookies",
    "ice cream",
  ],
  peanuts: [
    "trail mix",
    "mole",
    "granola",
    "pad thai",
    "egg rolls",
    "nougat",
    "energy bar",
    "candy bar",
    "massaman curry",
    "brittle",
    "cereal",
    "cookie",
    "dan dan noodles",
  ],
  soy: [
    "worcestershire sauce",
    "vegetable broth",
    "bouillon",
    "oyster sauce",
    "veggie burgers",
    "vegan cheese",
    "vegan sausage",
    "imitation bacon",
    "margarine",
    "shortening",
    "mayonnaise",
    "chocolate chips",
    "protein bar",
    "protein powder",
    "stir fry sauce",
    "stir-fry sauce",
  ],
  fish: [
    "caesar dressing",
    "kimchi",
    "red curry paste",
    "oyster sauce",
    "tapenade",
    "puttanesca",
    "caponata",
    "furikake",
    "pad thai",
    "som tam",
    "gumbo",
    "paella",
    "sushi",
    "ramen",
    "miso soup",
    "xo sauce",
    "sambal",
    "remoulade",
    "rémoulade",
  ],
  shellfish: [
    "kimchi",
    "curry paste",
    "paella",
    "surimi",
    "fish sauce",
    "gumbo",
    "jambalaya",
    "bouillabaisse",
    "pad thai",
    "sambal",
    "fish stock",
    "tom yum",
    "laksa",
    "fried rice",
    "egg roll",
    "dumplings",
    "wontons",
    "sushi",
    "ramen",
    "bisque",
    "chowder",
    "seafood seasoning",
    "ceviche",
  ],
  sesame: [
    "bagel",
    "bagels",
    "falafel",
    "burger buns",
    "sushi",
    "granola",
    "breadsticks",
    "crackers",
    "bibimbap",
    "stir fry",
    "stir-fry",
    "teriyaki sauce",
    "hoisin sauce",
    "chili oil",
    "dan dan noodles",
    "ramen",
    "poke",
    "seaweed salad",
    "energy bar",
    "veggie burger",
    "pretzel",
    "challah",
    "dumpling sauce",
  ],
};

// Foods that carry the allergen by definition: flagged like any other
// obvious ingredient.
const CONTAINS: Record<AllergenId, string[]> = {
  wheat: [],
  milk: ["queso", "lassi", "kefir", "bechamel", "béchamel", "alfredo sauce"],
  eggs: [
    "mayo",
    "custard",
    "souffle",
    "soufflé",
    "lemon curd",
    "royal icing",
    "french toast",
    "tartar sauce",
    "macaron",
    "macarons",
  ],
  tree_nuts: [
    "baklava",
    "frangipane",
    "amaretti",
    "mixed nuts",
    "turron",
    "turrón",
    "romesco",
    "dukkah",
    "macarons",
  ],
  peanuts: ["satay", "kung pao chicken", "gado gado", "mixed nuts"],
  soy: [
    "teriyaki sauce",
    "hoisin sauce",
    "ponzu",
    "natto",
    "gochujang",
    "black bean sauce",
  ],
  fish: ["nam pla", "taramasalata", "bouillabaisse", "imitation crab"],
  shellfish: [
    "belacan",
    "cioppino",
    "etouffee",
    "étouffée",
    "seafood stock",
    "xo sauce",
  ],
  sesame: [
    "furikake",
    "gomasio",
    "za'atar",
    "zaatar",
    "dukkah",
    "goma",
    "benne",
    "baba ganoush",
    "everything bagel",
  ],
};

describe("possible allergens (owner ruling 2026-11-15)", () => {
  it("every allergen has a possible list, in lower case", () => {
    for (const id of allergenIds) {
      const list = ALLERGEN_INGREDIENT_MAP[id].possibleIngredients;
      expect(Array.isArray(list)).toBe(true);
      for (const kw of list) expect(kw).toBe(kw.toLowerCase());
    }
  });

  it("no keyword sits in two lists of the same allergen", () => {
    for (const id of allergenIds) {
      const def = ALLERGEN_INGREDIENT_MAP[id];
      const all = [
        ...def.directIngredients,
        ...def.derivedIngredients,
        ...def.possibleIngredients,
      ];
      const dupes = all.filter((kw, i) => all.indexOf(kw) !== i);
      expect(dupes, id).toEqual([]);
    }
  });

  describe.each(allergenIds.map((id) => [id] as const))("%s", (id) => {
    it.each(POSSIBLE[id])('"%s" is a possible match', (ingredient) => {
      expect(entryFor(ingredient, id)).toEqual({
        id,
        viaDerived: true,
        possible: true,
      });
    });

    if (CONTAINS[id].length > 0) {
      it.each(CONTAINS[id])('"%s" is a definite match', (ingredient) => {
        const entry = entryFor(ingredient, id);
        expect(entry).toBeDefined();
        expect(entry?.possible).toBeUndefined();
      });
    }
  });

  describe("words that must not match", () => {
    it.each([
      ["icing sugar", "milk"],
      ["coconut milk", "tree_nuts"],
      ["tart cherries", "wheat"],
      ["plastic wrap", "wheat"],
      ["toasted sesame seeds", "wheat"],
      ["vegetable oil", "soy"],
      ["bunch of cilantro", "sesame"],
    ] as const)('"%s" is not flagged for %s', (ingredient, id) => {
      expect(entryFor(ingredient, id)).toBeUndefined();
    });

    it("peanut butter stays a peanut match only, not a tree-nut one", () => {
      expect(entryFor("peanut butter", "tree_nuts")).toBeUndefined();
      expect(entryFor("peanut butter", "peanuts")?.possible).toBeUndefined();
    });
  });

  describe("deriveRecipeAllergens precedence", () => {
    it("a definite match wins over a possible one", () => {
      expect(entryFor("flour", "wheat")).toEqual({
        id: "wheat",
        viaDerived: false,
      });
      expect(
        deriveRecipeAllergens(["crushed cookies", "wheat flour"]).find(
          (a) => a.id === "wheat",
        ),
      ).toEqual({ id: "wheat", viaDerived: false });
    });

    it("a hidden match wins over a possible one", () => {
      expect(
        deriveRecipeAllergens(["granola", "rolled oats"]).find(
          (a) => a.id === "wheat",
        ),
      ).toEqual({ id: "wheat", viaDerived: true });
    });
  });

  describe("isRecipeSafeForAllergies", () => {
    const recipe = deriveRecipeAllergens(["crushed cookies"]);
    it.each([
      ["mild", true],
      ["moderate", false],
      ["severe", false],
    ] as const)("a possible match at %s severity → safe=%s", (sev, safe) => {
      expect(
        isRecipeSafeForAllergies(recipe, [{ name: "wheat", severity: sev }]),
      ).toBe(safe);
    });
  });

  describe("detectAllergens", () => {
    it.each(["mild", "moderate", "severe"] as AllergySeverity[])(
      "reports a possible match at %s severity, marked possible",
      (severity) => {
        const matches = detectAllergens(
          ["2 cups crushed cookies"],
          [{ name: "wheat", severity }],
        );
        expect(matches).toEqual([
          {
            allergenId: "wheat",
            severity,
            ingredientName: "2 cups crushed cookies",
            matchedKeyword: "cookies",
            isDerived: false,
            isPossible: true,
          },
        ]);
      },
    );

    it("a definite keyword in the same ingredient wins", () => {
      const [match] = detectAllergens(
        ["wheat flour cookies"],
        [{ name: "wheat", severity: "mild" }],
      );
      expect(match.isPossible).toBe(false);
    });

    it("definite matches carry isPossible: false", () => {
      const [match] = detectAllergens(
        ["peanuts"],
        [{ name: "peanuts", severity: "mild" }],
      );
      expect(match.isPossible).toBe(false);
    });
  });

  describe("isBlockingAllergenMatch", () => {
    const match = (isPossible: boolean, severity: AllergySeverity) =>
      detectAllergens(
        [isPossible ? "cookies" : "flour"],
        [{ name: "wheat", severity }],
      )[0];

    it("a definite match always blocks", () => {
      expect(isBlockingAllergenMatch(match(false, "mild"))).toBe(true);
    });
    it("a possible match blocks for moderate and severe only", () => {
      expect(isBlockingAllergenMatch(match(true, "mild"))).toBe(false);
      expect(isBlockingAllergenMatch(match(true, "moderate"))).toBe(true);
      expect(isBlockingAllergenMatch(match(true, "severe"))).toBe(true);
    });
    it("a match with no isPossible field (older data) blocks", () => {
      const { isPossible: _drop, ...older } = match(true, "mild");
      expect(isBlockingAllergenMatch(older)).toBe(true);
    });
  });

  it("every single-word possible keyword has its plural listed", () => {
    // Single words match whole words only, so "cookie" does not find
    // "cookies". Mass nouns and words already plural are exempt.
    const EXEMPT = new Set([
      "granola",
      "gravy",
      "stuffing",
      "toast",
      "breading",
      "breaded",
      "roux",
      "soba",
      "vermicelli",
      "graham",
      "batter",
      "tempura",
      "meatloaf",
      "bouillon",
      "licorice",
      "surimi",
      "miso",
      "chocolate",
      "caramel",
      "frosting",
      "nougat",
      "sherbet",
      "creamer",
      "margarine",
      "toffee",
      "fudge",
      "chowder",
      "gratin",
      "pizza",
      "naan",
      "brioche",
      "challah",
      "mousse",
      "ramen",
      "pesto",
      "muesli",
      "amaretto",
      "mortadella",
      "mole",
      "biscotti",
      "korma",
      "pilaf",
      "fruitcake",
      "brittle",
      "shortening",
      "mayonnaise",
      "kimchi",
      "tapenade",
      "puttanesca",
      "caponata",
      "furikake",
      "gumbo",
      "paella",
      "sushi",
      "sambal",
      "remoulade",
      "rémoulade",
      "jambalaya",
      "bouillabaisse",
      "laksa",
      "bisque",
      "ceviche",
      "falafel",
      "bibimbap",
      "poke",
      "pudding",
      "cereal",
      "noodles",
      "stir-fry",
      "ranch",
      "worcestershire",
      "hoisin",
      "teriyaki",
    ]);
    const missing: string[] = [];
    for (const id of allergenIds) {
      const list = ALLERGEN_INGREDIENT_MAP[id].possibleIngredients;
      for (const kw of list) {
        if (kw.includes(" ") || EXEMPT.has(kw) || kw.endsWith("s")) continue;
        const hasPlural = list.some(
          (other) =>
            other !== kw && other.startsWith(kw) && other.endsWith("s"),
        );
        if (!hasPlural) missing.push(`${id}:${kw}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("uses the shared whole-word matcher for possible keywords", () => {
    expect(ingredientContainsKeyword("pine cones", "cones")).toBe(true);
    expect(entryFor("cornet", "wheat")).toBeUndefined();
  });

  describe("firstMatchPerIngredient", () => {
    const allergies = [
      { name: "sesame", severity: "mild" as const },
      { name: "wheat", severity: "mild" as const },
    ];
    it("prefers a definite match over an earlier possible one", () => {
      // "bagel" is possible sesame (listed first) and definite wheat.
      const map = firstMatchPerIngredient(
        detectAllergens(["bagel"], allergies),
      );
      expect(map.get("bagel")).toMatchObject({
        allergenId: "wheat",
        isPossible: false,
      });
    });
    it("keeps a possible match when nothing definite matched", () => {
      const map = firstMatchPerIngredient(
        detectAllergens(["falafel"], allergies),
      );
      expect(map.get("falafel")).toMatchObject({
        allergenId: "sesame",
        isPossible: true,
      });
    });
    it("keeps the first of two definite matches", () => {
      const map = firstMatchPerIngredient(
        detectAllergens(["tahini bread"], allergies),
      );
      expect(map.get("tahini bread")?.allergenId).toBe("sesame");
    });
  });
});
