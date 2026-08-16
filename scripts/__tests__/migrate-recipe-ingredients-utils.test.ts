import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  parseIngredientLine,
  cleanIngredientLine,
  cleanInstructionLine,
  splitInstructionsArray,
} from "../migrate-recipe-ingredients-utils";

describe("migrate-recipe-ingredients-utils", () => {
  describe("parseIngredientLine", () => {
    it.each([
      [
        "200g rice noodles",
        { quantity: "200", unit: "g", name: "rice noodles" },
      ],
      [
        "3 tbsp fish sauce",
        { quantity: "3", unit: "tbsp", name: "fish sauce" },
      ],
      ["1/2 cup flour", { quantity: "1/2", unit: "cup", name: "flour" }],
      ["2.5 l water", { quantity: "2.5", unit: "l", name: "water" }],
      [
        "1 cucumber, thinly sliced",
        { quantity: "1", unit: "", name: "cucumber, thinly sliced" },
      ],
      [
        "Fresh herbs (mint, cilantro, Thai basil)",
        {
          quantity: "",
          unit: "",
          name: "Fresh herbs (mint, cilantro, Thai basil)",
        },
      ],
    ])("parses %j", (input, expected) => {
      expect(parseIngredientLine(input)).toEqual(expected);
    });
  });

  describe("cleanIngredientLine", () => {
    it("strips bullets, numbering, and markdown bold", () => {
      expect(cleanIngredientLine("- 200g rice noodles")).toBe(
        "200g rice noodles",
      );
      expect(cleanIngredientLine("• 1 lime")).toBe("1 lime");
      expect(cleanIngredientLine("1. 3 tbsp fish sauce")).toBe(
        "3 tbsp fish sauce",
      );
      expect(cleanIngredientLine("**200g tofu**")).toBe("200g tofu");
    });
  });

  describe("cleanInstructionLine", () => {
    it("strips bold step labels, numbering, and bullets", () => {
      expect(cleanInstructionLine("**Prep Tofu:** press the tofu")).toBe(
        "press the tofu",
      );
      expect(cleanInstructionLine("1. Chop the onions")).toBe(
        "Chop the onions",
      );
      expect(cleanInstructionLine("- Serve hot")).toBe("Serve hot");
    });
  });

  describe("splitInstructionsArray — the four documented storage patterns", () => {
    it("Pattern A: ingredients + steps in one element separated by newlines", () => {
      const result = splitInstructionsArray([
        "Ingredients:\n200g rice noodles\n3 tbsp fish sauce\nInstructions:\nSoak the noodles\nStir-fry everything",
      ]);
      expect(result).not.toBeNull();
      expect(result!.ingredients).toHaveLength(2);
      expect(result!.ingredients[0]).toEqual({
        quantity: "200",
        unit: "g",
        name: "rice noodles",
      });
      expect(result!.instructions).toEqual([
        "Soak the noodles",
        "Stir-fry everything",
      ]);
    });

    it("Pattern B: markdown ### headers", () => {
      const result = splitInstructionsArray([
        "### Ingredients:\n- 1 block tofu\n- 2 tbsp soy sauce\n### Instructions:\n1. Press the tofu\n2. Fry until golden",
      ]);
      expect(result).not.toBeNull();
      expect(result!.ingredients).toHaveLength(2);
      expect(result!.ingredients[0]).toEqual({
        quantity: "1",
        unit: "",
        name: "block tofu",
      });
      expect(result!.instructions).toEqual([
        "Press the tofu",
        "Fry until golden",
      ]);
    });

    it("Pattern C: bold **Ingredients**: labels with a Steps section", () => {
      const result = splitInstructionsArray([
        "**Ingredients**:\n- 1 cucumber\n**Steps**:\n- Slice the cucumber",
      ]);
      expect(result).not.toBeNull();
      expect(result!.ingredients).toHaveLength(1);
      expect(result!.ingredients[0]).toEqual({
        quantity: "1",
        unit: "",
        name: "cucumber",
      });
      expect(result!.instructions).toEqual(["Slice the cucumber"]);
    });

    it("Pattern D: labels as separate array elements", () => {
      const result = splitInstructionsArray([
        "Ingredients:",
        "2 cups oats",
        "Instructions:",
        "Combine and rest overnight",
      ]);
      expect(result).not.toBeNull();
      expect(result!.ingredients).toHaveLength(1);
      expect(result!.ingredients[0]).toEqual({
        quantity: "2",
        unit: "cups",
        name: "oats",
      });
      expect(result!.instructions).toEqual(["Combine and rest overnight"]);
    });

    it.each(["Preparation", "Cooking", "Directions"])(
      "accepts the alternate steps header %s",
      (header) => {
        const result = splitInstructionsArray([
          `Ingredients:\n1 egg\n${header}:\nWhisk the egg`,
        ]);
        expect(result).not.toBeNull();
        expect(result!.instructions).toEqual(["Whisk the egg"]);
      },
    );

    it("returns null when there is no ingredients header", () => {
      expect(
        splitInstructionsArray(["Soak the noodles", "Stir-fry everything"]),
      ).toBeNull();
    });

    it("returns null when there is no steps header after the ingredients", () => {
      expect(
        splitInstructionsArray(["Ingredients:\n200g rice noodles\n3 limes"]),
      ).toBeNull();
    });

    it("returns null when the ingredient section is empty", () => {
      expect(
        splitInstructionsArray(["Ingredients:\nInstructions:\nMix well"]),
      ).toBeNull();
    });
  });

  describe("module import graph", () => {
    it("is importable without DATABASE_URL (stays db-free)", () => {
      const ROOT = join(__dirname, "..", "..");
      const utilsPath = join(
        ROOT,
        "scripts",
        "migrate-recipe-ingredients-utils.ts",
      );
      const env = { ...process.env };
      delete env.DATABASE_URL;
      const r = spawnSync(
        process.execPath,
        [
          "--import=tsx",
          "--input-type=module",
          "-e",
          `await import(${JSON.stringify(utilsPath)})`,
        ],
        { encoding: "utf8", timeout: 15_000, cwd: ROOT, env },
      );
      expect(r.stderr).toBe("");
      expect(r.status).toBe(0);
    });
  });
});
