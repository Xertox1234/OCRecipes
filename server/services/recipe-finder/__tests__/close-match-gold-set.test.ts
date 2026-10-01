import { describe, it, expect, vi, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import type { RecipeQuery } from "@shared/schemas/recipe-finder";
import {
  findCommunity,
  CLOSE_MATCH_RELATIVE,
  CLOSE_MATCH_FLOOR,
} from "../find-community";
import { initSearchIndex, resetSearchIndex } from "../../recipe-search";

vi.mock("../../../storage", () => ({
  storage: {
    getAllMealPlanRecipes: vi.fn().mockResolvedValue([]),
    getAllRecipeIngredients: vi.fn().mockResolvedValue(new Map()),
    // Read lazily inside the mock: vi.mock is hoisted above every
    // module-scope const, so the factory must not close over one.
    getAllPublicCommunityRecipes: vi.fn(async () => {
      const { readFileSync } = await import("node:fs");
      const rows: { createdAt: string | null }[] = JSON.parse(
        readFileSync(
          `${process.cwd()}/server/services/recipe-finder/__tests__/fixtures/community-catalog.json`,
          "utf8",
        ),
      );
      return rows.map((r) => ({
        ...r,
        createdAt: r.createdAt ? new Date(r.createdAt) : null,
      }));
    }),
    getPantryItems: vi.fn().mockResolvedValue([]),
    // safeForMe is a no-op for a user with no allergies.
    getUserProfile: vi.fn().mockResolvedValue(undefined),
  },
}));

// Read with fs, like nutrition-lookup.test.ts's cnf-gold-set.json.
const FIXTURES = path.join(
  process.cwd(),
  "server/services/recipe-finder/__tests__/fixtures",
);
const catalog: { createdAt: string | null }[] = JSON.parse(
  fs.readFileSync(path.join(FIXTURES, "community-catalog.json"), "utf8"),
);
interface GoldQuery {
  request: string;
  query: RecipeQuery;
  right: number[];
}
const gold: {
  measured: {
    relative: number | null;
    floor: number | null;
    right: string[];
    wrong: string[];
    none: string[];
  };
  queries: GoldQuery[];
} = JSON.parse(
  fs.readFileSync(path.join(FIXTURES, "finder-gold-set.json"), "utf8"),
);

type Outcome = "right" | "wrong" | "none";

async function outcomes(relative: number, floor: number) {
  const byOutcome: Record<Outcome, string[]> = {
    right: [],
    wrong: [],
    none: [],
  };
  let correct = 0;
  for (const g of gold.queries) {
    const items = await findCommunity(g.query, "gold-user", [], {
      relative,
      floor,
    });
    const outcome: Outcome =
      items.length === 0
        ? "none"
        : items.every((i) => g.right.includes(i.id))
          ? "right"
          : "wrong";
    byOutcome[outcome].push(g.request);
    if (
      (g.right.length === 0 && outcome === "none") ||
      (g.right.length > 0 && outcome === "right")
    ) {
      correct++;
    }
  }
  return { byOutcome, correct };
}

beforeAll(async () => {
  resetSearchIndex();
  await initSearchIndex();
});

describe.skipIf(process.env.MEASURE_FINDER_THRESHOLD !== "1")(
  "close-match threshold sweep (measurement)",
  () => {
    it("prints right/wrong/none per (relative, floor)", async () => {
      const rows: string[] = [];
      for (const relative of [0.3, 0.4, 0.5, 0.6, 0.7, 0.8]) {
        for (const floor of [0, 2, 4, 6, 8, 10, 12]) {
          const { byOutcome, correct } = await outcomes(relative, floor);
          rows.push(
            `${relative}\t${floor}\tcorrect=${correct}\tright=${byOutcome.right.length}\twrong=${byOutcome.wrong.length}\tnone=${byOutcome.none.length}`,
          );
        }
      }
      // eslint-disable-next-line no-console -- the sweep's output IS the measurement
      console.log(`relative\tfloor\t…\n${rows.join("\n")}`);
      expect(rows.length).toBeGreaterThan(0);
    });
  },
);

describe("close-match threshold — committed gold set", () => {
  it("uses the measured constants", () => {
    expect(CLOSE_MATCH_RELATIVE).toBe(gold.measured.relative);
    expect(CLOSE_MATCH_FLOOR).toBe(gold.measured.floor);
  });

  it("reproduces the measured right / wrong / none sets exactly", async () => {
    const { byOutcome } = await outcomes(
      CLOSE_MATCH_RELATIVE,
      CLOSE_MATCH_FLOOR,
    );
    expect(byOutcome.right.sort()).toEqual([...gold.measured.right].sort());
    expect(byOutcome.wrong.sort()).toEqual([...gold.measured.wrong].sort());
    expect(byOutcome.none.sort()).toEqual([...gold.measured.none].sort());
  });

  it("positive control: the fixture is loaded and at least one query finds a right match", async () => {
    expect(catalog.length).toBeGreaterThan(0);
    const { byOutcome } = await outcomes(
      CLOSE_MATCH_RELATIVE,
      CLOSE_MATCH_FLOOR,
    );
    expect(byOutcome.right.length).toBeGreaterThan(0);
  });
});
