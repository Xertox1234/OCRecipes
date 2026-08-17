import { describe, it, expect, vi, beforeEach } from "vitest";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  parseIngredientLine,
  cleanIngredientLine,
  cleanInstructionLine,
  splitInstructionsArray,
  parseCleanupFlags,
} from "../migrate-recipe-ingredients-utils";
import { main } from "../migrate-recipe-ingredients";
import { db } from "../../server/db";

// Deliberately generic — this mock proves the COMMIT GATE discriminates, not
// the split/parse logic (that's covered by splitInstructionsArray's own
// tests above).
vi.mock("../../server/db", () => {
  // One fixture row whose `instructions` blob is a real, splittable Pattern-A
  // payload — `splitInstructionsArray` must return non-null for the write
  // gate (inside the per-row loop) to ever be reached at all. Defined
  // INSIDE the factory: vi.mock factories are hoisted above module-scope
  // const declarations, so an outer-scope reference here would run before
  // it is initialized.
  const FIXTURE_ROW = {
    id: 1,
    title: "Fixture Recipe",
    instructions: [
      "Ingredients:\n200g rice noodles\nInstructions:\nCook it well",
    ],
    ingredients: [],
  };
  // A single flat object that is BOTH chainable (every builder method
  // returns the same object) AND thenable (awaiting it resolves the
  // fixture) — stands in for a Drizzle query/update builder.
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    select: vi.fn(() => chain),
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    set: vi.fn(() => chain),
    then: (resolve: (v: unknown) => void) => resolve([FIXTURE_ROW]),
  });
  return {
    db: {
      select: vi.fn(() => chain),
      // The real write gate: `main()` only reaches this on --commit.
      update: vi.fn(() => chain),
    },
  };
});

const mockDb = db as unknown as { update: ReturnType<typeof vi.fn> };

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
      // The steps filter drops lines starting with the header words, so a
      // duplicated "Directions" label leaves nothing behind.
      // NOT an endorsement of that filter: it is over-broad and also eats a
      // legitimate step like "Cooking time is 20 minutes". This test pins
      // only the case where the filter empties the list — the guard then
      // skips the row. The partial case (one step of five swallowed) is a
      // SEPARATE open defect and is deliberately not asserted here.
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

  describe("migrate-recipe-ingredients main() — the real commit gate (mocked db)", () => {
    // The banner text (asserted below via spawnSync against an unreachable
    // DB) sits BEFORE an unconditional `communityRecipes` select; the actual
    // `if (COMMIT) { await db.update(...) }` gate sits inside the per-row
    // loop AFTER it. No no-DB spawnSync test can ever reach that gate — this
    // suite mocks `db` so `main()` runs the real script logic in-process,
    // with one splittable fixture row, and asserts on the ONE thing that
    // gate actually controls: whether `db.update` is invoked at all.
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("a bare invocation does NOT reach db.update (must never write)", async () => {
      await main([]);
      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it("--commit DOES reach db.update (arms the write)", async () => {
      await main(["--commit"]);
      expect(mockDb.update).toHaveBeenCalled();
    });

    it("--commit --dry-run does NOT reach db.update (--dry-run vetoes)", async () => {
      await main(["--commit", "--dry-run"]);
      expect(mockDb.update).not.toHaveBeenCalled();
    });
  });

  describe("migrate-recipe-ingredients banner — wiring seam (spawnSync, no DB)", () => {
    // What this DOES prove: the real script correctly wires argv ->
    // parseCleanupFlags -> the printed banner. What it does NOT prove: that
    // the `if (COMMIT)` write gate itself is correct — see the mocked-db
    // suite above, which owns that guarantee.
    //
    // DATABASE_URL is set to a syntactically-valid but UNREACHABLE address
    // (never deleted, unlike the db-free import-pin below) — `server/db.ts`
    // throws synchronously at import if DATABASE_URL is unset, which would
    // crash before the banner ever prints. `pg`'s Pool connects lazily, so
    // the banner (printed before any query) is unaffected by the connection
    // failing a moment later.
    const ROOT = join(__dirname, "..", "..");
    const scriptPath = join(ROOT, "scripts", "migrate-recipe-ingredients.ts");
    const env = {
      ...process.env,
      DATABASE_URL: "postgresql://t:t@127.0.0.1:1/nope",
    };

    function run(...flags: string[]) {
      return spawnSync(
        process.execPath,
        ["--import=tsx", scriptPath, ...flags],
        {
          encoding: "utf8",
          timeout: 10_000,
          cwd: ROOT,
          env,
        },
      );
    }

    it("bare invocation prints === DRY RUN ===", () => {
      const r = run();
      expect(r.stdout).toContain(
        "=== DRY RUN ===  (pass --commit to write changes)",
      );
    });

    it("--commit prints === LIVE RUN ===", () => {
      const r = run("--commit");
      expect(r.stdout).toContain("=== LIVE RUN ===");
    });

    it("--commit --dry-run prints === DRY RUN === and NAMES --dry-run as the veto", () => {
      const r = run("--commit", "--dry-run");
      expect(r.stdout).toContain(
        "=== DRY RUN ===  (--dry-run overrides --commit; drop --dry-run to write changes)",
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
