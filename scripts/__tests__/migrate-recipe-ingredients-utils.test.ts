import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  parseIngredientLine,
  cleanIngredientLine,
  cleanInstructionLine,
  splitInstructionsArray,
  parseCleanupFlags,
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

    it("falls back to unwrapping bold markers instead of destroying a step with no label colon", () => {
      // The bold-label strip is destructive by design (a genuine label
      // should be discarded) — but with no colon to distinguish "label"
      // from "body", a step wrapped ENTIRELY in bold matches the same
      // pattern end-to-end and would otherwise be reduced to "".
      expect(
        cleanInstructionLine("**Press the tofu firmly between paper towels**"),
      ).toBe("Press the tofu firmly between paper towels");
    });

    it("does NOT let the fallback rescue a genuine label — the label is still discarded", () => {
      // Two-sided pin: the sibling test above proves the fallback fires when
      // the destructive strip empties the line; this proves the fallback
      // does NOT fire on the label case, where the destructive strip is
      // supposed to win and discard "Prep Tofu:". If a future change made
      // the label case ALSO empty out, the fallback would silently "rescue"
      // it as "Prep Tofu: press the tofu" instead — a different wrong
      // answer that a same-value assertion wouldn't catch.
      const result = cleanInstructionLine("**Prep Tofu:** press the tofu");
      expect(result).toBe("press the tofu");
      expect(result).not.toContain("Prep Tofu");
    });

    // GUARD-DEFEAT FIX. The fallback above is gated on the intermediate
    // AFTER the bullet/number strips, not on `raw` — a bare marker with NO
    // real content (just "1." or "-") reduces to "" during the bullet/number
    // strips alone, before the bold-label strip that the fallback exists to
    // rescue from ever runs. Gating on `raw` instead would revive these bare
    // markers as fake instruction text, defeating the caller's empty-result
    // data-loss guard for the one case it exists to catch. Found in review
    // by actually running these exact inputs.
    it.each(["1.", "-"])(
      "still reduces a bare bullet/number marker with no content to empty: %s",
      (bareMarker) => {
        expect(cleanInstructionLine(bareMarker)).toBe("");
      },
    );
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

    // DATA-LOSS GUARD. The caller writes `result.instructions` straight over
    // `communityRecipes.instructions` on --commit, and this script has NO
    // backup table (unlike migrate-instructions.ts). Before this guard existed
    // a blob whose "Instructions:" marker sat at the very end returned
    // `{ ingredients: [...], instructions: [] }`, so a live run replaced the
    // original prose with an empty array — unrecoverable, and visible in the
    // dry run only as an ABSENT "First instruction step:" line.
    it("returns null when the steps section is empty (never write [] over the prose)", () => {
      expect(
        splitInstructionsArray(["Ingredients:\n2 cups oats\nInstructions:\n"]),
      ).toBeNull();
    });

    it("returns null when the steps section is whitespace-only", () => {
      expect(
        splitInstructionsArray([
          "Ingredients:\n2 cups oats\nInstructions:\n   \n",
        ]),
      ).toBeNull();
    });

    it("returns null when the steps section holds only a repeated header line", () => {
      // The steps filter drops only header-SHAPED lines (the whole line,
      // optionally with a trailing colon), so a bare duplicated "Directions"
      // label still matches and leaves nothing behind — the guard then skips
      // the row. A real step that merely BEGINS with a header word (e.g.
      // "Cooking time is 20 minutes") now SURVIVES — see the "real steps
      // that begin with a header word" tests below, which pin the fix for
      // the partial-loss case this comment used to call a separate open defect.
      expect(
        splitInstructionsArray([
          "Ingredients:",
          "2 cups oats",
          "Instructions:",
          "Directions",
          "",
        ]),
      ).toBeNull();
    });

    // PARTIAL-LOSS FIX. Before this fix, the steps filter matched any line
    // PREFIXED by a header word, so a real step that happened to start with
    // "Instructions"/"Steps"/"Preparation"/"Cooking"/"Directions" was
    // silently swallowed — indistinguishable from an actual section header.
    // Each fixture below has a SECOND, plain step alongside the header-
    // prefixed one, so a regression that re-swallows the first step still
    // leaves a non-empty array (passing the data-loss guard) and would only
    // be caught by asserting the FULL array — not `toContain`.
    it.each([
      "Instructions from the original author call for a 9-inch pan.",
      "Steps 4 and 5 can be done a day ahead.",
      "Preparation note: bring the butter to room temperature first.",
      "Cooking time is about 20 minutes — check at 15.",
      "Directions may vary by oven; start checking early.",
    ])(
      "keeps a real step that begins with a header word: %s",
      (headerPrefixedStep) => {
        const result = splitInstructionsArray([
          `Ingredients:\n1 egg\n2 cups flour\nInstructions:\n${headerPrefixedStep}\nWhisk the egg`,
        ]);
        expect(result).not.toBeNull();
        expect(result!.instructions).toEqual([
          headerPrefixedStep,
          "Whisk the egg",
        ]);
      },
    );

    it("still drops a genuine header-only line even among real steps", () => {
      // Two-sided pin (docs/solutions/conventions/gate-test-needs-two-sided-negative-control-2026-07-25.md):
      // the sibling test above proves a header-PREFIXED sentence survives;
      // this proves a header-SHAPED line (the whole line, optionally with a
      // trailing colon) is still dropped, even when real steps surround it.
      const result = splitInstructionsArray([
        "Ingredients:\n1 egg\n2 cups flour\nInstructions:\nDirections:\nWhisk the egg\nFry until golden",
      ]);
      expect(result).not.toBeNull();
      expect(result!.instructions).toEqual([
        "Whisk the egg",
        "Fry until golden",
      ]);
    });

    it("keeps a real ingredient line that begins with the word 'ingredients'", () => {
      // Same header-SHAPED treatment applied to the `^ingredients` filter.
      const result = splitInstructionsArray([
        "Ingredients:\nIngredients from a local farm work best\n2 cups flour\nInstructions:\nWhisk the egg",
      ]);
      expect(result).not.toBeNull();
      expect(result!.ingredients.map((i) => i.name)).toEqual([
        "Ingredients from a local farm work best",
        "flour",
      ]);
    });

    it("reports only header-SHAPED drops, never blank-line drops, in droppedHeaderLines", () => {
      const result = splitInstructionsArray([
        "Ingredients:\n1 egg\n2 cups flour\nInstructions:\n\nDirections:\nWhisk the egg\n\nFry until golden",
      ]);
      expect(result).not.toBeNull();
      // Blank lines are filtered too, but must NOT show up as "dropped" —
      // only the genuine header echo ("Directions:") belongs in the report,
      // or the dry-run summary becomes noise on every row and operators stop
      // reading it.
      expect(result!.droppedHeaderLines).toEqual(["Directions:"]);
    });

    it("reports a header echo from the ingredients side too, in section order", () => {
      // Counterpart to the steps-side droppedHeaderLines test above — the
      // `^ingredients` filter got the identical header-SHAPED treatment
      // (AC: "gets the same treatment"), and the concatenation order
      // (ingredients half first, then steps half) is otherwise unverified.
      const result = splitInstructionsArray([
        "Ingredients:\nIngredients:\n1 egg\n2 cups flour\nInstructions:\nWhisk the egg",
      ]);
      expect(result).not.toBeNull();
      expect(result!.ingredients.map((i) => i.name)).toEqual(["egg", "flour"]);
      expect(result!.droppedHeaderLines).toEqual(["Ingredients:"]);
    });

    // LOCATOR ANCHOR FIX. Before this fix, the section-boundary regexes that
    // FIND "Ingredients:"/"Instructions:" (distinct from the per-line filters
    // above, which only run AFTER the boundary is found) were unanchored
    // substring matches — a header word appearing anywhere in the blob, even
    // mid-line inside real content, could hijack the split. Found in review
    // by actually running this exact input, not by inspection.
    it("does not let an ingredient line ending in a trigger word hijack the steps boundary", () => {
      const result = splitInstructionsArray([
        "Ingredients:\n2 tbsp oil for cooking\n1 egg\nInstructions:\nWhisk",
      ]);
      expect(result).not.toBeNull();
      expect(result!.ingredients).toEqual([
        { quantity: "2", unit: "tbsp", name: "oil for cooking" },
        { quantity: "1", unit: "", name: "egg" },
      ]);
      expect(result!.instructions).toEqual(["Whisk"]);
      // The tell that the split landed on the REAL "Instructions:" header
      // instead of eating a fake match mid-ingredient-line: nothing was
      // dropped as a header echo.
      expect(result!.droppedHeaderLines).toEqual([]);
    });

    // DESTRUCTIVE-CLEAN FIX. `cleanInstructionLine`'s bold-label strip is
    // destructive by design (a genuine "**Step 1:**" label should be
    // discarded) — but a step wrapped ENTIRELY in bold with no colon to
    // distinguish "label" from "body" used to match the same pattern
    // end-to-end and be destroyed to "", vanishing with zero signal (it
    // never reaches the header-shape filter, since `line.length > 0` runs
    // first). Found in review by actually running this exact input.
    it("keeps a step that is wrapped ENTIRELY in bold markdown with no label colon", () => {
      const result = splitInstructionsArray([
        "Ingredients:\n1 egg\nInstructions:\n**Press the tofu firmly between paper towels**\nFry until golden",
      ]);
      expect(result).not.toBeNull();
      expect(result!.instructions).toEqual([
        "Press the tofu firmly between paper towels",
        "Fry until golden",
      ]);
    });

    it("still finds an indented header line (leading whitespace tolerance)", () => {
      // The anchor fix above (`^` + `m`) closes the mid-line-hijack hole, but
      // a naive anchor would ALSO stop matching a header line that has
      // leading spaces/tabs — a real, previously-working input class. `[ \t]*`
      // tolerates the indentation while still requiring the header word to be
      // the first NON-whitespace content on the line (the sibling hijack
      // test above pins that "2 tbsp oil for cooking" still does not match).
      const result = splitInstructionsArray([
        "  Ingredients:\n1 egg\n2 cups flour\n  Instructions:\nWhisk the egg",
      ]);
      expect(result).not.toBeNull();
      expect(result!.ingredients.map((i) => i.name)).toEqual(["egg", "flour"]);
      expect(result!.instructions).toEqual(["Whisk the egg"]);
    });

    it("still finds Pattern C's numbered header line (numbered-prefix tolerance)", () => {
      // Same anchor-vs-coverage trade-off as leading whitespace above, this
      // time for the docblock's own claimed "Pattern C — bold label embedded
      // in a numbered element". `(?:\d+[.)]\s*)?` requires the digits be
      // immediately followed by "." or ")", so "2 tbsp oil for cooking"
      // (digit then a space) still cannot match it.
      const result = splitInstructionsArray([
        "1. **Ingredients**:\n- 1 cucumber\n2. **Steps**:\n- Slice the cucumber",
      ]);
      expect(result).not.toBeNull();
      expect(result!.ingredients).toEqual([
        { quantity: "1", unit: "", name: "cucumber" },
      ]);
      expect(result!.instructions).toEqual(["Slice the cucumber"]);
    });

    // GUARD-DEFEAT FIX (integration level). Counterpart to the
    // `cleanInstructionLine` unit tests above: a steps section whose ENTIRE
    // content is a bare bullet/number marker must still trip the
    // empty-result data-loss guard and return null — not silently write
    // `["1."]` over the recipe's real prose. Found in review by actually
    // running this exact input.
    it("still returns null when the steps section is only a bare number/bullet marker", () => {
      expect(
        splitInstructionsArray(["Ingredients:\n1 egg\nInstructions:\n1.\n"]),
      ).toBeNull();
      expect(
        splitInstructionsArray(["Ingredients:\n1 egg\nInstructions:\n-\n"]),
      ).toBeNull();
    });
  });

  describe("parseCleanupFlags — dry-run by default", () => {
    it("defaults to commit: false (a bare run must PREVIEW, never write)", () => {
      // Regression-by-design: the script used to LIVE-write by default with
      // opt-in --dry-run — the inverse of the repo's own cleanup-seed-recipes
      // safety pattern. A bare invocation now previews.
      expect(parseCleanupFlags(["node", "script.ts"])).toEqual({
        commit: false,
        vetoed: false,
      });
    });

    it("arms writes only on an explicit --commit", () => {
      expect(parseCleanupFlags(["node", "s", "--commit"])).toEqual({
        commit: true,
        vetoed: false,
      });
    });

    it("accepts legacy --dry-run as a harmless no-op alias (nothing vetoed)", () => {
      expect(parseCleanupFlags(["node", "s", "--dry-run"])).toEqual({
        commit: false,
        vetoed: false,
      });
    });

    it("--dry-run WINS over --commit in either order — and REPORTS the veto", () => {
      expect(parseCleanupFlags(["node", "s", "--commit", "--dry-run"])).toEqual(
        { commit: false, vetoed: true },
      );
      expect(parseCleanupFlags(["node", "s", "--dry-run", "--commit"])).toEqual(
        { commit: false, vetoed: true },
      );
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
      // Status carries the invariant; stderr uses a targeted negative, never
      // exact-empty — see server/services/__tests__/barcode-policy.test.ts
      // for why.
      expect(r.status).toBe(0);
      expect(r.stderr).not.toMatch(/error|DATABASE_URL/i);
    });
  });
});
