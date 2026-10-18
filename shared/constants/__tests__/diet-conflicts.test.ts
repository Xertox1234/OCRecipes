import { describe, it, expect } from "vitest";
import {
  deriveRecipeDietConflicts,
  parseDietConflicts,
} from "../diet-conflicts";

describe("deriveRecipeDietConflicts", () => {
  it("returns null for an empty ingredient list (unchecked, never 'none found')", () => {
    expect(deriveRecipeDietConflicts([])).toBeNull();
  });

  it("returns [] when ingredients are checked and nothing conflicts", () => {
    expect(deriveRecipeDietConflicts(["tomato", "basil", "olive oil"])).toEqual(
      [],
    );
  });

  it.each([
    ["streaky bacon", "meat"],
    ["Beef Mince", "meat"],
    ["pork sausages", "meat"],
    ["chicken thighs", "poultry"],
    ["duck breast", "poultry"],
    ["quail", "poultry"],
    ["gelatine leaves", "animal_derived"],
    ["lard", "animal_derived"],
    ["beef suet", "animal_derived"],
    ["bone broth", "animal_derived"],
    ["rennet", "animal_derived"],
    ["runny honey", "honey"],
    ["vegetable beef soup", "meat"],
    ["mushroom beef", "meat"],
    ["soy chicken", "poultry"],
    ["vegetable chicken soup", "poultry"],
    ["chicken egg noodles with chicken", "poultry"],
    ["ground meat", "meat"],
    ["meat sauce", "meat"],
    ["mutton", "meat"],
    ["rabbit", "meat"],
    ["lardons", "meat"],
    ["pastrami", "meat"],
    ["guanciale", "meat"],
    ["meat free-range", "meat"],
    ["meat free range", "meat"],
    ["meat, free-range", "meat"],
  ])("flags %s as %s", (ingredient, id) => {
    expect(deriveRecipeDietConflicts([ingredient])).toContain(id);
  });

  it.each([
    "minced garlic",
    "graham crackers",
    "gooseberry",
    "honeydew melon",
    "lamb's lettuce",
    "quail eggs",
    "duck eggs",
    "vegetable broth",
    "vegetable stock",
    "mushroom broth",
    "vegan gelatin",
    "veggie bacon",
    "plant-based sausage",
    "vegetarian rennet",
    "microbial rennet",
    "goat cheese",
    "meat-free mince",
    "meat-free",
    "meat free",
    "meat-free, vegan",
    "meat-free-style burger",
    "plant-based meat",
    "vegan chicken egg noodles",
  ])("does not flag %s", (ingredient) => {
    expect(deriveRecipeDietConflicts([ingredient])).toEqual([]);
  });

  it("returns each conflict once, in dietConflictIds order", () => {
    expect(
      deriveRecipeDietConflicts(["honey", "bacon", "ham", "chicken"]),
    ).toEqual(["meat", "poultry", "honey"]);
  });
});

describe("parseDietConflicts", () => {
  it("passes a valid array through", () => {
    expect(parseDietConflicts(["meat", "honey"])).toEqual(["meat", "honey"]);
  });
  it("treats null, undefined and non-arrays as unchecked", () => {
    expect(parseDietConflicts(null)).toBeNull();
    expect(parseDietConflicts(undefined)).toBeNull();
    expect(parseDietConflicts("meat")).toBeNull();
    expect(parseDietConflicts({})).toBeNull();
  });
  it("drops unknown ids instead of crashing", () => {
    expect(parseDietConflicts(["future_id", "meat", 3])).toEqual(["meat"]);
  });
});
