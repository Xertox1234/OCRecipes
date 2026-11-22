# Lane B — Property-based + Metamorphic Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three property-based suites (plus one stretch) over the pure nutrition/date/normalisation cores, each asserting named relations over generated input classes, each observed red once against a hand-broken implementation before it merges.

**Architecture:** Pure `*.property.test.ts` files beside the existing example suites, discovered by the base Vitest glob. The mechanism already exists (`fast-check`, seed-pin guard, Stryker exclusion); this lane adds files and one convention (a relations header). Metamorphic relations (batch ≡ map, fallback order) are ordinary `fc.asyncProperty` tests with the same provider mocks the example suite uses.

**Tech Stack:** Vitest 4, `fast-check` ^4.9.0, `vi.stubGlobal("fetch")`, `vi.mock("../../db")`.

**Spec:** `docs/superpowers/specs/2026-09-14-advanced-testing-lanes-design.md` §Lane B. Shared constraints: `docs/superpowers/plans/2026-09-14-advanced-testing-lanes-00-index.md` §Global Constraints.

## Global Constraints

- Every `fc.assert(...)` passes `FC_PARAMS = { seed: 20260914, numRuns: 100 } as const` — enforced by `scripts/__tests__/fast-check-property-seed-guard.test.ts`.
- Every file opens with a **relations header** listing each relation by id (`R1`, `R2`, …) and the assertion that carries it.
- Never add a property file to any `testInclude` in `stryker.targets.mjs`.
- **Red-run evidence:** each task's last step breaks the implementation by hand, runs the file, pastes the shrunk counterexample into the PR body, then reverts. A relation that cannot be made to fail is not a relation — fix the test.
- If a relation fails on the _real_ code, decide which is wrong: a real defect gets its own commit and a note in the PR; a mis-stated relation gets a narrower arbitrary with the reason in the header. Never widen a tolerance to make it pass.
- Commit messages: no backticks in `-m`; end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. In a `/todo` worktree use `/usr/bin/git`.
- **STOP after each completed task** (green + committed + reviewed): report and end the turn so the user can compact. See index §Execution protocol.

## File structure

| File                                                                | Relations                                                          |
| ------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `server/lib/__tests__/civil-date.property.test.ts`                  | R1 round-trip, R2 hour range, R3 midnight monotone                 |
| `server/lib/__tests__/recipe-normalization.property.test.ts`        | R1 idempotence ×7, R2 integer-quantity preservation, R3 robustness |
| `server/services/__tests__/nutrition-lookup.property.test.ts`       | R1 batch ≡ map, R2 fallback order, R3 field-count monotone         |
| `server/lib/__tests__/macro-gap-context.property.test.ts` (stretch) | R1 determinism, R2 single-largest-gap wording                      |

---

### Task 1: `civil-date` properties

**Files:**

- Create: `server/lib/__tests__/civil-date.property.test.ts`

**Interfaces:**

- Consumes (`server/lib/civil-date.ts`): `civilMidnightUtcMs(year: number, month: number /* 1-based */, day: number, tz: string): number`; `civilDateString(date: Date, tz?: string): string` (`YYYY-MM-DD` via `Intl` `en-CA`); `civilDateToInstant(dateStr: string, tz?: string): Date` (documented inverse of `civilDateString`); `civilHourInTz(date: Date, tz?: string): number`.

- [x] **Step 1: Write the file (the test IS the deliverable; it must be green on the real code)**

```ts
// server/lib/__tests__/civil-date.property.test.ts
/**
 * Property-based tests for server/lib/civil-date.ts (fast-check).
 *
 * RELATIONS
 *   R1 round-trip  civilDateString(civilDateToInstant(s, tz), tz) === s
 *                  for every civil date s and every zone in TZ_SAMPLE — the
 *                  inverse the module's own docs promise, over generated input.
 *   R2 hour-range  civilHourInTz(d, tz) is an integer in [0, 23].
 *   R3 monotone    civilMidnightUtcMs is strictly increasing when the civil
 *                  date advances by one day, for a fixed zone (DST days included).
 *
 * Why properties here: this module exists because `new Date("yyyy-mm-dd")` is
 * UTC midnight and reads back as the PREVIOUS day west of Greenwich — a bug
 * this codebase shipped. Example tests pin the dates the author thought of;
 * these cover the class.
 *
 * Seed pinning: vitest.config.ts sets retry: 2; an unseeded counterexample
 * could pass on a fresh seed and mask a real defect. Pinned per the repo
 * convention (fast-check-property-tests-pin-seed-…-2026-07-12.md).
 * Not in any Stryker testInclude.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  civilDateString,
  civilDateToInstant,
  civilHourInTz,
  civilMidnightUtcMs,
} from "../civil-date";

const FC_PARAMS = { seed: 20260914, numRuns: 100 } as const;

// Both sides of Greenwich, half-hour and DST zones, and a zone whose DST
// transition happens AT midnight (America/Santiago — the module's own edge case).
const TZ_SAMPLE = [
  "UTC",
  "America/Toronto",
  "America/Los_Angeles",
  "America/Santiago",
  "Europe/London",
  "Asia/Kolkata",
  "Australia/Sydney",
  "Pacific/Auckland",
] as const;

const arbTz = fc.constantFrom(...TZ_SAMPLE);

interface Civil {
  year: number;
  month: number;
  day: number;
}
const pad2 = (n: number) => String(n).padStart(2, "0");
const toDateStr = ({ year, month, day }: Civil) =>
  `${year}-${pad2(month)}-${pad2(day)}`;

// day ≤ 28 so every generated triple is a real calendar date in every month.
const arbCivil: fc.Arbitrary<Civil> = fc.record({
  year: fc.integer({ min: 1971, max: 2099 }),
  month: fc.integer({ min: 1, max: 12 }),
  day: fc.integer({ min: 1, max: 28 }),
});
// day ≤ 27 so "the next day" (day + 1) is also always a real date.
const arbCivilWithNext: fc.Arbitrary<Civil> = fc.record({
  year: fc.integer({ min: 1971, max: 2099 }),
  month: fc.integer({ min: 1, max: 12 }),
  day: fc.integer({ min: 1, max: 27 }),
});

const arbInstant = fc.date({
  min: new Date("1971-01-01T00:00:00Z"),
  max: new Date("2099-12-31T23:59:59Z"),
  noInvalidDate: true,
});

describe("civil-date properties", () => {
  it("R1: civilDateString ∘ civilDateToInstant is the identity on civil dates", () => {
    fc.assert(
      fc.property(arbCivil, arbTz, (civil, tz) => {
        const s = toDateStr(civil);
        expect(civilDateString(civilDateToInstant(s, tz), tz)).toBe(s);
      }),
      FC_PARAMS,
    );
  });

  it("R2: civilHourInTz is an integer hour in [0, 23]", () => {
    fc.assert(
      fc.property(arbInstant, arbTz, (d, tz) => {
        const h = civilHourInTz(d, tz);
        expect(Number.isInteger(h)).toBe(true);
        expect(h).toBeGreaterThanOrEqual(0);
        expect(h).toBeLessThanOrEqual(23);
      }),
      FC_PARAMS,
    );
  });

  it("R3: civil midnight strictly increases with the civil date", () => {
    fc.assert(
      fc.property(arbCivilWithNext, arbTz, (civil, tz) => {
        const today = civilMidnightUtcMs(
          civil.year,
          civil.month,
          civil.day,
          tz,
        );
        const tomorrow = civilMidnightUtcMs(
          civil.year,
          civil.month,
          civil.day + 1,
          tz,
        );
        expect(tomorrow).toBeGreaterThan(today);
        // A civil day is 23, 24, or 25 hours long — never anything else.
        expect([23, 24, 25]).toContain((tomorrow - today) / 3_600_000);
      }),
      FC_PARAMS,
    );
  });
});
```

- [x] **Step 2: Run it — must be green on the real code, and the seed guard must accept it**

Run: `npx vitest run server/lib/__tests__/civil-date.property.test.ts scripts/__tests__/fast-check-property-seed-guard.test.ts`
Expected: PASS. If R3's day-length assertion fails for `America/Santiago`, the zone's midnight transition made a day 23 or 25 hours long — those values are already accepted; a value like 24.5 means a half-hour zone transition and the accepted set should be extended only with a comment citing the zone and date fast-check printed.

- [x] **Step 3: Red-run evidence (then revert)**

In `server/lib/civil-date.ts`, temporarily change `civilDateToInstant` to `return new Date(civilMidnightUtcMs(year, month, day + 1, tz));`. Run the file. Expected: R1 fails with a shrunk counterexample such as `{ year: 1971, month: 1, day: 1 }, "UTC"`. Paste the failure block into the PR body under "Red-run evidence", then `git checkout -- server/lib/civil-date.ts`.

- [x] **Step 4: Commit**

```bash
git add server/lib/__tests__/civil-date.property.test.ts
git commit -m "test(civil-date): property tests for round-trip, hour range, and midnight monotonicity

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `recipe-normalization` properties

**Files:**

- Create: `server/lib/__tests__/recipe-normalization.property.test.ts`

**Interfaces:**

- Consumes (`server/lib/recipe-normalization.ts`): `normalizeTitle(title: string): string`; `normalizeDescription(desc: string | null | undefined): string | null`; `normalizeDifficulty(d: string | null | undefined): string | null`; `normalizeInstructions(i: string[] | null | undefined): string[]`; `normalizeUnit(unit: string | null | undefined): string`; `normalizeIngredient(ing: IngredientInput): IngredientInput` where `IngredientInput = { name: string; quantity: string; unit: string }` (quantity is passed through `normalizeQuantityToDecimal(trimmed) ?? trimmed`, and when both quantity and unit are blank a measurement is extracted from the name); `normalizeRecipeFields(data: RecipeFieldsInput): NormalizedRecipeFields` where `RecipeFieldsInput = { title?: string; description?: string | null; difficulty?: string | null; instructions?: string[] | null; ingredients?: Array<{ name: string; quantity?: string | null; unit?: string | null }> | null }`.

- [x] **Step 1: Write the file**

```ts
// server/lib/__tests__/recipe-normalization.property.test.ts
/**
 * Property-based tests for server/lib/recipe-normalization.ts (fast-check).
 *
 * RELATIONS
 *   R1 idempotence  f(f(x)) deep-equals f(x) for all seven exports — a
 *                   normaliser that keeps changing its own output is not one.
 *   R2 quantity     for an integer quantity string with a non-blank unit,
 *                   Number(normalizeIngredient(ing).quantity) === Number(ing.quantity)
 *                   (the unit-extraction branch is skipped by keeping unit non-blank).
 *   R3 robustness   normalizeRecipeFields never throws over arbitrary strings
 *                   and arrays — the fuzz-shaped coverage that replaces a fuzzer.
 *
 * Seed pinning per repo convention; not in any Stryker testInclude.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  normalizeDescription,
  normalizeDifficulty,
  normalizeIngredient,
  normalizeInstructions,
  normalizeRecipeFields,
  normalizeTitle,
  normalizeUnit,
  type IngredientInput,
  type RecipeFieldsInput,
} from "../recipe-normalization";

const FC_PARAMS = { seed: 20260914, numRuns: 100 } as const;

// Unicode-inclusive strings: the normalisers see real user input.
const arbText = fc.string({ maxLength: 60, unit: "grapheme" });
const arbMaybeText = fc.option(arbText, { nil: null });
const arbUnit = fc.constantFrom(
  "cup",
  "cups",
  "g",
  "kg",
  "ml",
  "tbsp",
  "TSP",
  " oz ",
  "pinch",
  "",
);
const arbIngredient: fc.Arbitrary<IngredientInput> = fc.record({
  name: arbText,
  quantity: fc.oneof(
    fc.integer({ min: 0, max: 999 }).map(String),
    fc.constantFrom("1/2", "1 1/2", "0.25", "", "  3 "),
    arbText,
  ),
  unit: arbUnit,
});
const arbFields: fc.Arbitrary<RecipeFieldsInput> = fc.record(
  {
    title: arbText,
    description: arbMaybeText,
    difficulty: arbMaybeText,
    instructions: fc.option(fc.array(arbText, { maxLength: 8 }), { nil: null }),
    ingredients: fc.option(
      fc.array(
        fc.record({
          name: arbText,
          quantity: fc.option(arbText, { nil: null }),
          unit: fc.option(arbUnit, { nil: null }),
        }),
        { maxLength: 6 },
      ),
      { nil: null },
    ),
  },
  { requiredKeys: [] },
);

describe("recipe-normalization properties", () => {
  describe("R1: idempotence", () => {
    it("normalizeTitle", () => {
      fc.assert(
        fc.property(arbText, (s) => {
          expect(normalizeTitle(normalizeTitle(s))).toBe(normalizeTitle(s));
        }),
        FC_PARAMS,
      );
    });
    it("normalizeDescription", () => {
      fc.assert(
        fc.property(arbMaybeText, (s) => {
          expect(normalizeDescription(normalizeDescription(s))).toBe(
            normalizeDescription(s),
          );
        }),
        FC_PARAMS,
      );
    });
    it("normalizeDifficulty", () => {
      fc.assert(
        fc.property(arbMaybeText, (s) => {
          expect(normalizeDifficulty(normalizeDifficulty(s))).toBe(
            normalizeDifficulty(s),
          );
        }),
        FC_PARAMS,
      );
    });
    it("normalizeInstructions", () => {
      fc.assert(
        fc.property(
          fc.option(fc.array(arbText, { maxLength: 8 }), { nil: null }),
          (xs) => {
            expect(normalizeInstructions(normalizeInstructions(xs))).toEqual(
              normalizeInstructions(xs),
            );
          },
        ),
        FC_PARAMS,
      );
    });
    it("normalizeUnit", () => {
      fc.assert(
        fc.property(fc.oneof(arbUnit, arbText), (u) => {
          expect(normalizeUnit(normalizeUnit(u))).toBe(normalizeUnit(u));
        }),
        FC_PARAMS,
      );
    });
    it("normalizeIngredient", () => {
      fc.assert(
        fc.property(arbIngredient, (ing) => {
          const once = normalizeIngredient(ing);
          expect(normalizeIngredient(once)).toEqual(once);
        }),
        FC_PARAMS,
      );
    });
    it("normalizeRecipeFields", () => {
      fc.assert(
        fc.property(arbFields, (data) => {
          const once = normalizeRecipeFields(data);
          expect(normalizeRecipeFields(once)).toEqual(once);
        }),
        FC_PARAMS,
      );
    });
  });

  it("R2: an integer quantity keeps its numeric value", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 999 }),
        arbText,
        fc.constantFrom("cup", "g", "ml", "tbsp"),
        (n, name, unit) => {
          const out = normalizeIngredient({ name, quantity: String(n), unit });
          expect(Number(out.quantity)).toBe(n);
        },
      ),
      FC_PARAMS,
    );
  });

  it("R3: normalizeRecipeFields never throws on arbitrary input", () => {
    fc.assert(
      fc.property(arbFields, (data) => {
        expect(() => normalizeRecipeFields(data)).not.toThrow();
      }),
      FC_PARAMS,
    );
  });
});
```

- [x] **Step 2: Run it — green on the real code; seed guard green**

Run: `npx vitest run server/lib/__tests__/recipe-normalization.property.test.ts scripts/__tests__/fast-check-property-seed-guard.test.ts`
Expected: PASS. If an R1 case fails, read the shrunk input: (a) a genuine non-idempotent normaliser (e.g. a title-casing pass that re-transforms its own output) is a real defect — fix it in its own commit and keep the property; (b) an input the normaliser is documented not to accept (check the function's doc comment) narrows that arbitrary, with the reason added to the header. Do not delete the relation.

- [x] **Step 3: Red-run evidence (then revert)**

In `normalizeUnit`, temporarily append a character to every non-empty result (e.g. `return result + "x";` at its final return). Run the file. Expected: R1 `normalizeUnit` and `normalizeIngredient` fail with shrunk counterexamples. Paste into the PR body; `git checkout -- server/lib/recipe-normalization.ts`.

- [x] **Step 4: Commit**

```bash
git add server/lib/__tests__/recipe-normalization.property.test.ts
git commit -m "test(recipe-normalization): idempotence, quantity-preservation, and robustness properties

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `nutrition-lookup` metamorphic properties

**Files:**

- Create: `server/services/__tests__/nutrition-lookup.property.test.ts`

**Interfaces:**

- Consumes (`server/services/nutrition-lookup.ts`): `lookupNutrition(query: string): Promise<NutritionData | null>`; `batchNutritionLookup(items: string[]): Promise<Map<string, NutritionData | null>>`; `countNonNullNutritionFields(data)`; `_resetCNFCacheForTesting(): void`. Provider chain in `fetchNutritionFromSources` (line 723): CNF (`food-nutrition.canada.ca/…/food/?lang=en|fr`, then `nutrientamount/?…&id=<code>`) → USDA (`api.nal.usda.gov/fdc/v1/foods/search`) → API Ninjas (`api.api-ninjas.com/v1/nutrition`, skipped when `API_NINJAS_KEY` is unset). All calls go through `cachedFetch` (`dev-api-cache.ts`), a bare `fetch` passthrough under Vitest (`NODE_ENV !== "development"`), so a global fetch stub sees every call. Cache reads use `db.select().from().where()`; cache writes go through `storage.setNutritionCache` → `db.insert().values().onConflictDoUpdate()`.
- Mocks mirror `server/services/__tests__/nutrition-lookup.test.ts` lines 12–70 exactly (hoisted `mockInsertValues`, `vi.mock("../../db")`, `vi.stubGlobal("fetch")`, URL-routed `setupFetchMock`).

- [x] **Step 1: Write the file**

```ts
// server/services/__tests__/nutrition-lookup.property.test.ts
/**
 * Metamorphic property tests for server/services/nutrition-lookup.ts.
 *
 * The oracle problem: the "right" nutrition numbers for an arbitrary food are
 * unknowable in a unit test. What IS knowable is how results must RELATE:
 *
 * RELATIONS
 *   R1 batch ≡ map   batchNutritionLookup(items) equals a Map built from
 *                    lookupNutrition(item) for each item — for every list,
 *                    including empty lists and duplicates. (Both paths call
 *                    fetchNutritionFromSources for uncached items; the batch
 *                    path must not change any per-item answer.)
 *   R2 fallback      when CNF resolves with calories > 0, neither USDA nor
 *                    API Ninjas is called; when CNF misses, USDA is called;
 *                    API Ninjas is called only after a USDA miss.
 *   R3 monotone      countNonNullNutritionFields never decreases when a null
 *                    field is filled in.
 *
 * Providers are mocked by URL exactly as the example suite does; the item
 * alphabet is chosen so each item deterministically exercises one branch of
 * the chain: "sugar" → CNF hit (calories 387); "chicken breast" → CNF miss
 * (no word overlap with the sugar-only CNF list) → USDA hit; "zzz-unknown" →
 * every provider misses → null.
 *
 * Seed pinning per repo convention; not in any Stryker testInclude.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";
import {
  lookupNutrition,
  batchNutritionLookup,
  countNonNullNutritionFields,
  _resetCNFCacheForTesting,
} from "../nutrition-lookup";

const { mockInsertValues } = vi.hoisted(() => ({
  mockInsertValues: vi.fn().mockReturnValue({
    onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
    onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("../../db", () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
    insert: vi.fn().mockReturnValue({ values: mockInsertValues }),
  },
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

type Router = Record<
  string,
  () => Promise<{ ok: boolean; json: () => Promise<unknown> }>
>;
function setupFetchMock(urlResponses: Router) {
  mockFetch.mockImplementation((url: string) => {
    for (const [pattern, responseFn] of Object.entries(urlResponses)) {
      if (url.includes(pattern)) return responseFn();
    }
    return Promise.resolve({ ok: false, json: async () => ({}) });
  });
}
const json = (body: unknown) => () =>
  Promise.resolve({ ok: true, json: async () => body });

// CNF list contains ONLY sugar, so "chicken breast" cannot fuzzy-match it
// (fuzzyMatchCNF needs score ≥ 8; zero word overlap scores 0).
const CNF_EN = [
  { food_code: 4318, food_description: "Sweets, sugars, granulated" },
];
const CNF_FR = [
  { food_code: 4318, food_description: "Confiseries, sucre, granulé" },
];
const CNF_SUGAR_NUTRIENTS = [
  {
    food_code: 4318,
    nutrient_value: 387,
    nutrient_name_id: 208,
    nutrient_web_name: "Energy (kcal)",
  },
  {
    food_code: 4318,
    nutrient_value: 0,
    nutrient_name_id: 203,
    nutrient_web_name: "Protein",
  },
  {
    food_code: 4318,
    nutrient_value: 99.98,
    nutrient_name_id: 205,
    nutrient_web_name: "Carbohydrate",
  },
  {
    food_code: 4318,
    nutrient_value: 0,
    nutrient_name_id: 204,
    nutrient_web_name: "Total Fat",
  },
];
const USDA_CHICKEN = {
  foods: [
    {
      description: "Chicken Breast",
      foodNutrients: [
        { nutrientName: "Energy", value: 165 },
        { nutrientName: "Protein", value: 31 },
        { nutrientName: "Carbohydrate, by difference", value: 0 },
        { nutrientName: "Total lipid (fat)", value: 3.6 },
      ],
    },
  ],
};

function routeProviders() {
  setupFetchMock({
    "food/?lang=en": json(CNF_EN),
    "food/?lang=fr": json(CNF_FR),
    "nutrientamount/?lang=en&type=json&id=4318": json(CNF_SUGAR_NUTRIENTS),
    "fdc/v1/foods/search?query=chicken": json(USDA_CHICKEN),
    "fdc/v1/foods/search": json({ foods: [] }),
    "api.api-ninjas.com": json([]),
  });
}

const ITEM_ALPHABET = ["sugar", "chicken breast", "zzz-unknown"] as const;
const arbItems = fc.array(fc.constantFrom(...ITEM_ALPHABET), { maxLength: 6 });

const FC_PARAMS = { seed: 20260914, numRuns: 100 } as const;

function urlsFetched(): string[] {
  return mockFetch.mock.calls.map((c) => String(c[0]));
}

describe("nutrition-lookup metamorphic properties", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    _resetCNFCacheForTesting();
    process.env.API_NINJAS_KEY = "test-key";
    routeProviders();
  });

  it("R1: batchNutritionLookup(items) ≡ Map(items.map(lookupNutrition))", async () => {
    await fc.assert(
      fc.asyncProperty(arbItems, async (items) => {
        _resetCNFCacheForTesting();
        const expected = new Map<string, unknown>();
        for (const item of items)
          expected.set(item, await lookupNutrition(item));
        _resetCNFCacheForTesting();
        const actual = await batchNutritionLookup(items);
        expect([...actual.keys()].sort()).toEqual([...expected.keys()].sort());
        for (const [k, v] of expected) expect(actual.get(k)).toEqual(v);
      }),
      FC_PARAMS,
    );
  });

  it("R2: the provider chain stops at the first hit (CNF → USDA → API Ninjas)", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...ITEM_ALPHABET), async (item) => {
        mockFetch.mockClear();
        _resetCNFCacheForTesting();
        const result = await lookupNutrition(item);
        const urls = urlsFetched();
        const hitUsda = urls.some((u) => u.includes("api.nal.usda.gov"));
        const hitNinjas = urls.some((u) => u.includes("api.api-ninjas.com"));
        if (item === "sugar") {
          expect(result?.calories).toBe(387);
          expect(hitUsda).toBe(false);
          expect(hitNinjas).toBe(false);
        } else if (item === "chicken breast") {
          expect(result?.calories).toBe(165);
          expect(hitUsda).toBe(true);
          expect(hitNinjas).toBe(false);
        } else {
          expect(result).toBeNull();
          expect(hitUsda).toBe(true);
          expect(hitNinjas).toBe(true);
        }
      }),
      FC_PARAMS,
    );
  });

  it("R3: countNonNullNutritionFields is monotone under filling a null", () => {
    const fieldNames = [
      "calories",
      "protein",
      "carbs",
      "fat",
      "fiber",
      "sugar",
      "sodium",
    ] as const;
    const arbData = fc.record(
      Object.fromEntries(
        fieldNames.map((f) => [
          f,
          fc.option(fc.float({ min: 0, max: 1000, noNaN: true }), {
            nil: null,
          }),
        ]),
      ) as Record<(typeof fieldNames)[number], fc.Arbitrary<number | null>>,
    );
    fc.assert(
      fc.property(
        arbData,
        fc.constantFrom(...fieldNames),
        fc.float({ min: 0, max: 1000, noNaN: true }),
        (data, field, value) => {
          const before = countNonNullNutritionFields(data);
          const after = countNonNullNutritionFields({
            ...data,
            [field]: data[field] ?? value,
          });
          expect(after).toBeGreaterThanOrEqual(before);
          expect(after - before).toBeLessThanOrEqual(1);
        },
      ),
      FC_PARAMS,
    );
  });
});
```

If `countNonNullNutritionFields`'s parameter type rejects the seven-field record (check its signature at `nutrition-lookup.ts:812`), add the remaining fields it names with `null` values in `arbData` — the relation is about counting, not about which fields exist.

- [x] **Step 2: Run it — green on the real code; seed guard green**

Run: `npx vitest run server/services/__tests__/nutrition-lookup.property.test.ts scripts/__tests__/fast-check-property-seed-guard.test.ts`
Expected: PASS. If R2's `"chicken breast"` case shows `hitUsda === false` with a non-null result, CNF fuzzy-matched it against the sugar entry — replace the item with `"qqq usda item"` in `ITEM_ALPHABET` and the USDA route key with `search?query=qqq` (the relation is about the chain, not the word). If R1 fails only on lists with duplicates, the batch path returned a different object for the second occurrence — that is a real finding; report it and keep the relation.

- [x] **Step 3: Red-run evidence (then revert)**

In `fetchNutritionFromSources` (`nutrition-lookup.ts:723`), temporarily swap the order so USDA is tried before CNF. Run the file. Expected: R2 fails for `"sugar"` (`hitUsda` true). Paste into the PR body; `git checkout -- server/services/nutrition-lookup.ts`.

- [x] **Step 4: Commit**

```bash
git add server/services/__tests__/nutrition-lookup.property.test.ts
git commit -m "test(nutrition-lookup): metamorphic properties for batch/single consistency and fallback order

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4 (stretch — last in, first cut): `macro-gap-context` properties

**Files:**

- Create: `server/lib/__tests__/macro-gap-context.property.test.ts`

**Interfaces:**

- Consumes: `buildMacroGapEmphasis(targets: MacroTargets, remaining: MacroTargets): string` with `MacroTargets = { calories: number; protein: number; carbs: number; fat: number }` (`server/lib/macro-gap-context.ts:1-6, 29`). Already a 100 %-killed Stryker target; properties add input breadth only.

- [ ] **Step 1: Write the file**

```ts
// server/lib/__tests__/macro-gap-context.property.test.ts
/**
 * Property-based tests for server/lib/macro-gap-context.ts.
 *
 * RELATIONS
 *   R1 determinism   same (targets, remaining) → same string (pure function).
 *   R2 no-gap silence when nothing remains (remaining all ≤ 0) the emphasis
 *                    names no macro (empty string).
 *   R3 largest wins  when exactly one macro has a large remaining ratio and
 *                    the others are fully met, the emphasis mentions that macro
 *                    and none of the others.
 *
 * Seed pinning per repo convention; not in the Stryker testInclude for this
 * target (macro-gap-context.test.ts stays the mutation oracle).
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { buildMacroGapEmphasis, type MacroTargets } from "../macro-gap-context";

const FC_PARAMS = { seed: 20260914, numRuns: 100 } as const;
const KEYS = ["calories", "protein", "carbs", "fat"] as const;

const arbTargets: fc.Arbitrary<MacroTargets> = fc.record({
  calories: fc.integer({ min: 1200, max: 4000 }),
  protein: fc.integer({ min: 40, max: 250 }),
  carbs: fc.integer({ min: 50, max: 500 }),
  fat: fc.integer({ min: 20, max: 200 }),
});

describe("macro-gap-context properties", () => {
  it("R1: deterministic", () => {
    fc.assert(
      fc.property(arbTargets, arbTargets, (t, r) => {
        expect(buildMacroGapEmphasis(t, r)).toBe(buildMacroGapEmphasis(t, r));
      }),
      FC_PARAMS,
    );
  });

  it("R2: nothing remaining → no emphasis", () => {
    fc.assert(
      fc.property(arbTargets, (t) => {
        const met: MacroTargets = { calories: 0, protein: 0, carbs: 0, fat: 0 };
        expect(buildMacroGapEmphasis(t, met)).toBe("");
      }),
      FC_PARAMS,
    );
  });

  it("R3: a single large gap is the one named", () => {
    fc.assert(
      fc.property(arbTargets, fc.constantFrom(...KEYS), (t, key) => {
        const remaining: MacroTargets = {
          calories: 0,
          protein: 0,
          carbs: 0,
          fat: 0,
        };
        remaining[key] = t[key]; // 100 % of that macro still to go
        const out = buildMacroGapEmphasis(t, remaining).toLowerCase();
        expect(out).toContain(key);
        for (const other of KEYS)
          if (other !== key) expect(out).not.toContain(other);
      }),
      FC_PARAMS,
    );
  });
});
```

- [ ] **Step 2: Run; read the shrunk input on any failure**

Run: `npx vitest run server/lib/__tests__/macro-gap-context.property.test.ts scripts/__tests__/fast-check-property-seed-guard.test.ts`
Expected: PASS. If R3 fails because the emphasis text says e.g. "protein" inside a longer phrase for another macro, tighten the assertion to a word-boundary match (`new RegExp(\`\\b${other}\\b\`)`) — the relation stands; the check was too coarse. If the module's `GAP_THRESHOLD`means a 100 % gap is not "large" for some macro, read the threshold constant and set`remaining[key]` above it explicitly in the header's terms.

- [ ] **Step 3: Red-run evidence (then revert)** — temporarily make `buildMacroGapEmphasis` return the emphasis for the _smallest_ gap instead of the largest; R3 must fail. Paste; revert.

- [ ] **Step 4: Commit**

```bash
git add server/lib/__tests__/macro-gap-context.property.test.ts
git commit -m "test(macro-gap-context): determinism and largest-gap properties

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

## Verification (per PR)

```bash
npx vitest run <the new property file> scripts/__tests__/fast-check-property-seed-guard.test.ts
grep -n "property.test" stryker.targets.mjs || echo "no property file in any Stryker testInclude (correct)"
```

Expected: green; the grep prints the "(correct)" line.

## Considered and rejected

- Quantity preservation as a _string_ identity — `normalizeIngredient` legitimately rewrites `"1/2"` to `"0.5"`; the integer-value relation (R2) is the honest invariant.
- Random real food names for the nutrition alphabet — the CNF fuzzy matcher makes arbitrary strings non-deterministic across branches; a three-item alphabet with one item per branch is what makes R2 a relation instead of a guess.
