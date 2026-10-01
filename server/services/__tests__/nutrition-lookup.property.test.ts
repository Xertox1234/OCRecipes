// server/services/__tests__/nutrition-lookup.property.test.ts
/**
 * Metamorphic property tests for server/services/nutrition-lookup.ts.
 *
 * The oracle problem: the "right" nutrition numbers for an arbitrary food are
 * unknowable in a unit test. What IS knowable is how results must RELATE:
 *
 * RELATIONS
 *   R1 batch ≡ map   with the nutrition cache cold (the db mock always
 *                    misses), batchNutritionLookup(items) equals a Map built
 *                    from lookupNutrition(item) for each item — for every
 *                    list, including empty lists, duplicates, and two
 *                    spellings of one cache key ("sugar", " sugar"), each
 *                    answered under its own key. This pins the fresh path
 *                    only: with a warm cache, getNutritionCacheBatch hands
 *                    the hit to the first spelling alone, so the relation
 *                    does not hold there today (todos/P2-2026-09-30-
 *                    nutrition-cache-batch-shared-key-spellings.md).
 *   R2 fallback      when CNF resolves with calories > 0, neither USDA nor
 *                    API Ninjas is called; when CNF misses, USDA is called;
 *                    API Ninjas is called only after a USDA miss.
 *   R3 exact count   filling one null field raises countNonNullNutritionFields
 *                    by exactly one, and re-setting a non-null field leaves it
 *                    unchanged — checked for every field on every draw, so a
 *                    field the count skips or counts twice is caught.
 *   R4 label mapping mapLabelToNutritionData copies each provided numeric
 *                    label field to its NutritionData field exactly
 *                    (Object.is, so -0, NaN and Infinity included) and maps
 *                    a null or absent one to 0.
 *
 * Providers are mocked by URL exactly as the example suite does; the item
 * alphabet is chosen so each item deterministically exercises one branch of
 * the chain: "sugar" → CNF hit (calories 387); "chicken breast" → CNF miss
 * (no word overlap with the sugar-only CNF list) → USDA hit; "zzz-unknown" →
 * every provider misses → null. getStandardizedFoodName returns each of
 * them unchanged (measured), so fetchNutritionFromSources tries one query
 * per provider before API Ninjas. R1 also draws KEY_VARIANTS, spellings that
 * normalise to an alphabet item's cache key and resolve the same way.
 *
 * REGIME
 *   Under the pinned seed (measured): R1 draws 19 empty lists, 39 with a
 *   repeated item and 28 with two spellings of one cache key; R2 draws each
 *   item 30–36 times; R3 fills each field's null 12–21 times; R4 checks
 *   484 provided and 216 null or absent fields, the provided ones including
 *   NaN once, -0 three times and ±Infinity three times. After each
 *   fc.assert, the relation asserts it saw its regime.
 *
 * Seed pinning per repo convention; not in any Stryker testInclude.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fc from "fast-check";
import {
  lookupNutrition,
  batchNutritionLookup,
  countNonNullNutritionFields,
  mapLabelToNutritionData,
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
// Spellings that share a cache key with an ITEM_ALPHABET entry but differ
// as strings: the batch path must still answer each one under its own key.
const KEY_VARIANTS = ["Sugar", " sugar", "chicken  breast"] as const;
const arbItems = fc.array(fc.constantFrom(...ITEM_ALPHABET, ...KEY_VARIANTS), {
  maxLength: 6,
});
// Mirrors normalizeForCache in nutrition-lookup.ts, which is not exported.
function cacheKey(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}

const FC_PARAMS = { seed: 20260914, numRuns: 100 } as const;

function hostsFetched(): string[] {
  return mockFetch.mock.calls.map((c) => new URL(String(c[0])).hostname);
}

describe("nutrition-lookup metamorphic properties", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    _resetCNFCacheForTesting();
    vi.stubEnv("API_NINJAS_KEY", "test-key");
    routeProviders();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("R1: batchNutritionLookup(items) ≡ Map(items.map(lookupNutrition))", async () => {
    let empty = 0;
    let withDuplicates = 0;
    let sharedKey = 0;
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
        const distinct = new Set(items).size;
        if (items.length === 0) empty++;
        if (distinct < items.length) withDuplicates++;
        if (new Set(items.map(cacheKey)).size < distinct) sharedKey++;
      }),
      FC_PARAMS,
    );
    expect(empty).toBeGreaterThan(0);
    expect(withDuplicates).toBeGreaterThan(0);
    expect(sharedKey).toBeGreaterThan(0);
  });

  it("R2: the provider chain stops at the first hit (CNF → USDA → API Ninjas)", async () => {
    const seen = new Set<string>();
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...ITEM_ALPHABET), async (item) => {
        mockFetch.mockClear();
        _resetCNFCacheForTesting();
        const result = await lookupNutrition(item);
        seen.add(item);
        const hosts = hostsFetched();
        const hitUsda = hosts.includes("api.nal.usda.gov");
        const hitNinjas = hosts.includes("api.api-ninjas.com");
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
    expect([...seen].sort()).toEqual([...ITEM_ALPHABET].sort());
  });

  it("R3: filling a null field raises countNonNullNutritionFields by exactly one", () => {
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
    const filled = Object.fromEntries(fieldNames.map((f) => [f, 0]));
    fc.assert(
      fc.property(
        arbData,
        fc.float({ min: 0, max: 1000, noNaN: true }),
        (data, value) => {
          const before = countNonNullNutritionFields(data);
          for (const field of fieldNames) {
            const wasNull = data[field] === null;
            if (wasNull) filled[field]++;
            const after = countNonNullNutritionFields({
              ...data,
              [field]: data[field] ?? value,
            });
            expect(after - before).toBe(wasNull ? 1 : 0);
          }
        },
      ),
      FC_PARAMS,
    );
    expect(fieldNames.filter((f) => filled[f] === 0)).toEqual([]);
  });
  it("R4: mapLabelToNutritionData keeps each provided numeric field exactly", () => {
    const LABEL_TO_DATA = [
      ["calories", "calories"],
      ["protein", "protein"],
      ["totalCarbs", "carbs"],
      ["totalFat", "fat"],
      ["dietaryFiber", "fiber"],
      ["totalSugars", "sugar"],
      ["sodium", "sodium"],
    ] as const;
    type LabelKey = (typeof LABEL_TO_DATA)[number][0];
    const arbLabel = fc.record(
      Object.fromEntries(
        LABEL_TO_DATA.map(([from]) => [
          from,
          fc.option(fc.double(), { nil: null }),
        ]),
      ) as Record<LabelKey, fc.Arbitrary<number | null>>,
      { requiredKeys: [] },
    );
    let provided = 0;
    let missing = 0;
    fc.assert(
      fc.property(arbLabel, (label) => {
        const out = mapLabelToNutritionData(label);
        for (const [from, to] of LABEL_TO_DATA) {
          const value = label[from];
          if (value == null) {
            missing++;
            expect(out[to]).toBe(0);
          } else {
            provided++;
            expect(out[to]).toBe(value);
          }
        }
      }),
      FC_PARAMS,
    );
    expect(provided).toBeGreaterThan(0);
    expect(missing).toBeGreaterThan(0);
  });
});
