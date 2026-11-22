# Smart Scan — Universal Nutrition Flags & Data Enrichment (v1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich the barcode result screen with more nutrient data from Open Food Facts and surface four free, universal, objective nutrition flags (High-in-Sugar/Sat-Fat/Sodium, Ultra-processed, High-in-Caffeine, Artificial-sweeteners + Nutri-Score) at scan time.

**Architecture:** Extend the Phase-1 `ScanFlag` pipeline. A new **pure** evaluator (`evaluateUniversalFlags`) takes only product data (no user profile) and emits objective flags; the barcode route concatenates them with the Phase-1 allergen flags on the existing `flags[]` overlay. New OFF fields are read live per request and **never persisted** (ODbL). The client partitions flags into a personal "For you" (allergen) section and a universal "Heads up" section on `NutritionDetailScreen`, and renders new nutrient rows + a Nutri-Score grade chip.

**Tech Stack:** TypeScript (strict), Express, Zod, Drizzle (untouched here), React Native / Expo, Vitest, React Query.

**Spec:** `docs/superpowers/specs/2026-07-22-smart-scan-universal-nutrition-flags-design.md`

## Global Constraints

_Every task's requirements implicitly include this section._

- **Branch first.** All work on a feature branch (`git checkout -b feat/smart-scan-universal-flags`) — never commit to `main` (CLAUDE.md).
- **TDD.** Failing test → run-red → minimal impl → run-green → commit. One behavior per test.
- **Free & universal.** The four flag families are free for everyone. Tag them `tier: "nutrition"` — **NEVER `"insight"`** (`"insight"` is the reserved premium-strip marker; tagging universal flags `"insight"` would let a future serializer silently drop them).
- **Fail-safe.** Missing a nutrient/field → **no flag / no row**, never treat missing as `0`. (Phase-1 allergen flags stay fail-**dangerous** and MUST NOT change behavior.)
- **ODbL.** OFF-derived content (`nova_group`, `additives_tags`, `nutriscore_grade`, `categories_tags`, `ingredients_text`, caffeine) is read live and **never written** to `barcodeNutrition` or any Public-API-feeding table. `barcodeNutrition` keeps its current 4 columns (cal/protein/carbs/fat) — do not add to its insert.
- **Salt↔sodium: convert once.** The app's canonical unit is sodium (mg). FSA sodium thresholds are pre-computed to mg constants (`salt(g)×400`); do not re-derive salt in the evaluator, and read sodium from one OFF source only (`sodium_100g` mapping already in `barcode-lookup.ts`).
- **Caffeine copy:** neutral. `"High in caffeine"` / `"Contains caffeine"`. Never "don't drink this."
- **Additives copy:** `"Contains artificial sweeteners"` only (curated E-number set). No broad "contains additives."
- **A11y (CI-gated).** New badge colors reuse the tested `badge-severity-visuals` tokens; the Nutri-Score chip's A–E palette is contrast-tested (AA, light + dark). Universal flags are **static reading-order content — never `announceForAccessibility`** (`accessibilityLiveRegion` is Android-only and not a substitute). The "Heads up" row is one `accessible={true}` group with a summarizing label.
- **LSP-first** on shared symbols (`ScanFlag`, `BarcodePer100g`, `BarcodeLookupResult`, `NutritionData`) before editing — `findReferences` to size the blast radius (`docs/rules/lsp.md`). Warm the server with one `hover` first; the first query can be cold.
- **Test command:** `npx vitest run <path> -t "<name>"` for a single test; `npx vitest run <path>` for a file.
- **Commit style:** conventional commits, `feat(scan): …` / `test(scan): …`.

---

## File Structure

**Shared**

- `shared/types/scan-flags.ts` _(modify)_ — new `ScanFlagKind`/`ScanFlagTier` members, `nutrient`/`value`/`grade` fields, `pickTopFlag`.

**Server — OFF enrichment (data)**

- `server/services/nutrition-lookup.ts:118` _(modify)_ — extend `offNutrimentsSchema` with new numeric keys.
- `server/services/barcode-lookup.ts` _(modify)_ — `BarcodePer100g` + scale/normalize/merge new nutrients; OFF→per100g mapping; `BarcodeLookupResult` product-level `novaGroup`/`nutriScore`; new pure `extractOffUniversalData()`.

**Server — flag evaluator (pure core)**

- `server/services/nutrition-flag-rules.ts` _(create)_ — FSA threshold constants (food + beverage, sodium in mg), caffeine threshold, artificial-sweetener E-number set, beverage-category anchor, multilingual caffeine regex.
- `server/services/universal-flags.ts` _(create)_ — `evaluateUniversalFlags(input): ScanFlag[]` (pure).

**Server — delivery**

- `server/routes/nutrition.ts:107-153` _(modify)_ — universal flag pass; concat + order with allergen flags; attach display fields; strip raw OFF content.

**Client — data + display**

- `client/lib/serving-size-utils.ts` _(modify)_ — carry/scale `saturatedFat`, `transFat`, `cholesterol`, `caffeine`.
- `client/hooks/useNutritionLookup.ts` _(modify)_ — `NutritionData` new fields + populate from response; partition helper.
- `client/components/NutriScoreChip.tsx` + `client/components/nutri-score-chip-utils.ts` _(create)_ — A–E grade chip + contrast-tested palette.
- `client/screens/NutritionDetailScreen.tsx` _(modify)_ — partition flags into "For you"/"Heads up", grade chip, new nutrient rows.

**Client — scan-lock chip (last, droppable)**

- `client/camera/types/scan-phase.ts` _(modify)_ — rename/extend `safetyFlag` → `topFlag`.
- `client/screens/ScanScreen.tsx` _(modify)_ — populate `topFlag` via `pickTopFlag`.

---

## Task 1: Extend ScanFlag types + `pickTopFlag`

**Files:**

- Modify: `shared/types/scan-flags.ts`
- Test: `shared/types/__tests__/scan-flags.test.ts` (create if absent)

**Interfaces:**

- Produces:
  - `ScanFlagKind` gains `"nutrient" | "processing" | "sweetener" | "nutriscore"`.
  - `ScanFlagTier` gains `"nutrition"` (free universal; `"insight"` stays reserved).
  - `type NutrientKind = "sugar" | "saturated_fat" | "sodium" | "caffeine"`.
  - `ScanFlag` gains optional `nutrient?: NutrientKind`, `value?: { amount: number; unit: string }`, `grade?: "a"|"b"|"c"|"d"|"e"`.
  - `pickTopFlag(flags: ScanFlag[]): ScanFlag | undefined` — highest severity; ties broken toward allergen kind.

- [ ] **Step 1: Write the failing test**

```ts
// shared/types/__tests__/scan-flags.test.ts
import { describe, it, expect } from "vitest";
import { pickTopFlag, type ScanFlag } from "../scan-flags";

const f = (over: Partial<ScanFlag>): ScanFlag => ({
  id: "x",
  kind: "nutrient",
  severity: "info",
  tier: "nutrition",
  title: "t",
  ...over,
});

describe("pickTopFlag", () => {
  it("returns the highest-severity flag", () => {
    const top = pickTopFlag([
      f({ severity: "info" }),
      f({ severity: "danger" }),
      f({ severity: "warn" }),
    ]);
    expect(top?.severity).toBe("danger");
  });
  it("breaks severity ties toward the allergen flag", () => {
    const allergen = f({
      id: "a",
      kind: "allergen",
      severity: "warn",
      tier: "safety",
    });
    const nutrient = f({ id: "n", kind: "nutrient", severity: "warn" });
    expect(pickTopFlag([nutrient, allergen])?.id).toBe("a");
  });
  it("returns undefined for an empty list", () => {
    expect(pickTopFlag([])).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run shared/types/__tests__/scan-flags.test.ts`
Expected: FAIL — `pickTopFlag is not a function`.

- [ ] **Step 3: Implement the type extensions + `pickTopFlag`**

In `shared/types/scan-flags.ts`, extend the unions and interface, and add the function (reuse the existing `SEVERITY_RANK`):

```ts
export type ScanFlagKind =
  | "allergen"
  | "allergen-unavailable"
  | "nutrient"
  | "processing"
  | "sweetener"
  | "nutriscore";

// "nutrition" = free universal (Phase 2). "insight" stays RESERVED for the v2 premium boost.
export type ScanFlagTier = "safety" | "nutrition" | "insight";

export type NutrientKind = "sugar" | "saturated_fat" | "sodium" | "caffeine";

export interface ScanFlag {
  id: string;
  kind: ScanFlagKind;
  severity: ScanFlagSeverity;
  tier: ScanFlagTier;
  title: string;
  detail?: string;
  allergenId?: AllergenId;
  /** Present on kind==="nutrient". */
  nutrient?: NutrientKind;
  /** Optional numeric detail, e.g. { amount: 160, unit: "mg" } for caffeine. */
  value?: { amount: number; unit: string };
  /** Present on kind==="nutriscore". */
  grade?: "a" | "b" | "c" | "d" | "e";
}

/** Highest-severity flag across ALL kinds; severity ties break toward allergen (safety). */
export function pickTopFlag(flags: ScanFlag[]): ScanFlag | undefined {
  let top: ScanFlag | undefined;
  const isAllergen = (fl: ScanFlag) =>
    fl.kind === "allergen" || fl.kind === "allergen-unavailable";
  for (const fl of flags) {
    if (!top) {
      top = fl;
      continue;
    }
    const delta = SEVERITY_RANK[fl.severity] - SEVERITY_RANK[top.severity];
    if (delta > 0 || (delta === 0 && isAllergen(fl) && !isAllergen(top)))
      top = fl;
  }
  return top;
}
```

Leave `pickTopSafetyFlag` unchanged (Phase 1 depends on it).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run shared/types/__tests__/scan-flags.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add shared/types/scan-flags.ts shared/types/__tests__/scan-flags.test.ts
git commit -m "feat(scan): extend ScanFlag with universal kinds, nutrition tier, pickTopFlag"
```

---

## Task 2: Carry & scale new nutrients through `BarcodePer100g`

**Files:**

- Modify: `server/services/barcode-lookup.ts` (`BarcodePer100g` ~23-31; `scaleNutrients` ~150; `normalizeToPerHundredGrams` ~169; merge ~209-236)
- Modify: `server/services/nutrition-lookup.ts:118` (`offNutrimentsSchema`)
- Test: `server/services/__tests__/barcode-lookup.test.ts` (existing)

**Interfaces:**

- Produces: `BarcodePer100g` gains `saturatedFat?`, `transFat?`, `cholesterol?`, `caffeine?` (all optional numbers; caffeine in **mg**, the rest in the label's native unit — g except cholesterol mg).

- [ ] **Step 1: Write the failing test**

```ts
// in barcode-lookup.test.ts
import { scaleNutrients } from "../barcode-lookup"; // export it if not already
it("scales the new nutrients with the serving factor", () => {
  const scaled = scaleNutrients(
    {
      calories: 100,
      saturatedFat: 2,
      transFat: 0.5,
      cholesterol: 10,
      caffeine: 32,
    },
    2,
  );
  expect(scaled.saturatedFat).toBe(4);
  expect(scaled.transFat).toBe(1);
  expect(scaled.cholesterol).toBe(20);
  expect(scaled.caffeine).toBe(64);
});
```

(If `scaleNutrients` is not exported, add `export` to it in this task — it is pure.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/services/__tests__/barcode-lookup.test.ts -t "scales the new nutrients"`
Expected: FAIL — new fields are `undefined`.

- [ ] **Step 3: Implement**

Extend the interface:

```ts
export interface BarcodePer100g {
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  fiber?: number;
  sugar?: number;
  sodium?: number;
  saturatedFat?: number; // g
  transFat?: number; // g
  cholesterol?: number; // mg
  caffeine?: number; // mg
}
```

Add the four fields anywhere the seven existing macros are mapped, using the SAME helpers already in the file — in `scaleNutrients` (mirror the `fiber: s(n.fiber)` lines), in `normalizeToPerHundredGrams` (mirror `fiber: roundToOneDecimal(data.fiber * factor)` — but `NutritionData` from the name-search path has none of these, so default to `undefined`/skip there), and in the primary/secondary merge (`saturatedFat: primary.saturatedFat ?? secondary.saturatedFat`, etc.). Extend `offNutrimentsSchema` in `nutrition-lookup.ts` with the raw keys for typed access:

```ts
// add to the z.object({...}) at nutrition-lookup.ts:118 (schema is .passthrough())
"saturated-fat_100g": z.number().optional(),
"trans-fat_100g": z.number().optional(),
"cholesterol_100g": z.number().optional(),
"caffeine_100g": z.number().optional(),
"caffeine_serving": z.number().optional(),
"caffeine_unit": z.string().optional(),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/services/__tests__/barcode-lookup.test.ts -t "scales the new nutrients"`
Expected: PASS. Then run the whole file to confirm no regression: `npx vitest run server/services/__tests__/barcode-lookup.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add server/services/barcode-lookup.ts server/services/nutrition-lookup.ts server/services/__tests__/barcode-lookup.test.ts
git commit -m "feat(scan): carry saturatedFat/transFat/cholesterol/caffeine through BarcodePer100g"
```

---

## Task 3: Map new OFF nutriments into per-100g

**Files:**

- Modify: `server/services/barcode-lookup.ts` (OFF→per100g mapping ~438-453)
- Test: `server/services/__tests__/barcode-lookup.test.ts`

**Interfaces:**

- Consumes: OFF nutriments `nm` (Task 2 schema keys).
- Produces: OFF-sourced `per100g` now populates `saturatedFat`/`transFat`/`cholesterol`/`caffeine` (caffeine converted g→mg).

- [ ] **Step 1: Write the failing test** (mirror the existing OFF-fixture tests in this file — they already pass `categories_tags`/`nutriments`)

```ts
it("maps OFF saturated-fat and caffeine (g→mg) into per100g", async () => {
  // Use the file's existing OFF-fetch mock/fixture helper; product nutriments:
  //   "saturated-fat_100g": 0, "caffeine_100g": 0.032
  const result = await lookupBarcodeWithMockedOff({
    nutriments: {
      "energy-kcal_100g": 45,
      "saturated-fat_100g": 0,
      caffeine_100g: 0.032,
    },
  });
  expect(result?.per100g.saturatedFat).toBe(0);
  expect(result?.per100g.caffeine).toBe(32); // 0.032 g → 32 mg
});
```

(Reuse whatever OFF-mock harness the existing tests in this file use — do not invent a new one.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/services/__tests__/barcode-lookup.test.ts -t "maps OFF saturated-fat and caffeine"`
Expected: FAIL — fields `undefined`.

- [ ] **Step 3: Implement** — in the OFF nutriment mapping block (~438-453), alongside `fiber: nm.fiber_100g` etc., add:

```ts
saturatedFat: nm["saturated-fat_100g"],
transFat: nm["trans-fat_100g"],
cholesterol: nm.cholesterol_100g !== undefined
  ? roundToOneDecimal(nm.cholesterol_100g * 1000) // OFF cholesterol_100g is g → mg
  : undefined,
caffeine: nm.caffeine_100g !== undefined
  ? roundToOneDecimal(nm.caffeine_100g * 1000) // OFF caffeine is g (caffeine_unit "g") → mg
  : undefined,
```

Guard the edge case where `caffeine_unit` is already `"mg"` (rare) — if `nm.caffeine_unit === "mg"`, use `nm.caffeine_100g` directly.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/services/__tests__/barcode-lookup.test.ts`
Expected: PASS (new + existing).

- [ ] **Step 5: Commit**

```bash
git add server/services/barcode-lookup.ts server/services/__tests__/barcode-lookup.test.ts
git commit -m "feat(scan): map OFF saturated-fat/trans-fat/cholesterol/caffeine into per100g"
```

---

## Task 4: `extractOffUniversalData` + product-level NOVA / Nutri-Score

**Files:**

- Modify: `server/services/barcode-lookup.ts` (add pure `extractOffUniversalData`; extend `BarcodeLookupResult`; call in `lookupBarcode` assembly — mirror `extractOffAllergenData`)
- Test: `server/services/__tests__/barcode-lookup.test.ts`

**Interfaces:**

- Produces:
  - `extractOffUniversalData(offProduct: Record<string, any> | null): { novaGroup?: number; nutriScore?: string; additivesTags: string[]; categoriesTags: string[] }` — pure, exported (mirror of `extractOffAllergenData`).
  - `BarcodeLookupResult` gains `novaGroup?: number`, `nutriScore?: string`, `additivesTags?: string[]`, `categoriesTags?: string[]` (raw tags flow to the route, then get stripped — like `allergenTags`).

- [ ] **Step 1: Write the failing test**

```ts
import { extractOffUniversalData } from "../barcode-lookup";
describe("extractOffUniversalData", () => {
  it("pulls nova/nutriscore/additives/categories from an OFF product", () => {
    const out = extractOffUniversalData({
      nova_group: 4,
      nutriscore_grade: "e",
      additives_tags: ["en:e951", "en:e150d"],
      categories_tags: ["en:beverages", "en:energy-drinks"],
    });
    expect(out.novaGroup).toBe(4);
    expect(out.nutriScore).toBe("e");
    expect(out.additivesTags).toEqual(["en:e951", "en:e150d"]);
    expect(out.categoriesTags).toContain("en:beverages");
  });
  it("returns empty arrays and undefined grades for a null product", () => {
    const out = extractOffUniversalData(null);
    expect(out.additivesTags).toEqual([]);
    expect(out.novaGroup).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/services/__tests__/barcode-lookup.test.ts -t "extractOffUniversalData"`
Expected: FAIL — not exported.

- [ ] **Step 3: Implement** (place directly below `extractOffAllergenData`, same defensive style):

```ts
export function extractOffUniversalData(
  offProduct: Record<string, any> | null,
): {
  novaGroup?: number;
  nutriScore?: string;
  additivesTags: string[];
  categoriesTags: string[];
} {
  const strArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((t): t is string => typeof t === "string") : [];
  const nova = offProduct?.nova_group;
  const grade = offProduct?.nutriscore_grade;
  return {
    novaGroup: typeof nova === "number" ? nova : undefined,
    nutriScore: typeof grade === "string" ? grade.toLowerCase() : undefined,
    additivesTags: strArr(offProduct?.additives_tags),
    categoriesTags: strArr(offProduct?.categories_tags),
  };
}
```

Extend `BarcodeLookupResult` with the four optional fields, and in the `lookupBarcode` result assembly (where `extractOffAllergenData(...)` is spread onto the result), also spread `extractOffUniversalData(offProduct)`. **Do not** add any of these to the `barcodeNutrition` insert (ODbL — Global Constraint).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/services/__tests__/barcode-lookup.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/services/barcode-lookup.ts server/services/__tests__/barcode-lookup.test.ts
git commit -m "feat(scan): extract OFF nova/nutriscore/additives/categories (read-live, not persisted)"
```

---

## Task 5: Flag-rule constants + `evaluateUniversalFlags` skeleton (High-in-Sugar/Sat-Fat/Sodium)

**Files:**

- Create: `server/services/nutrition-flag-rules.ts`
- Create: `server/services/universal-flags.ts`
- Test: `server/services/__tests__/universal-flags.test.ts` (create)

**Interfaces:**

- Produces:
  - `nutrition-flag-rules.ts`: `FSA_FOOD`, `FSA_DRINK`, `FSA_PORTION` threshold objects; `CAFFEINE_HIGH_MG = 150`; `ARTIFICIAL_SWEETENER_ETAGS: Set<string>`; `BEVERAGE_PARENT = "en:beverages"`; `CAFFEINE_INGREDIENT_RE`; `CAFFEINE_CATEGORY_TAGS: string[]`; `isBeverageCategory(tags: string[]): boolean`.
  - `universal-flags.ts`:
    ```ts
    export interface UniversalNutrients {
      sugar?: number;
      saturatedFat?: number;
      sodium?: number;
      caffeine?: number;
    }
    export interface UniversalFlagInput {
      per100g: UniversalNutrients; // per 100 g, or per 100 ml when isBeverage
      perServing?: UniversalNutrients; // only when serving data is trusted
      servingGrams?: number;
      categoriesTags: string[];
      novaGroup?: number;
      nutriScore?: string;
      additivesTags: string[];
      ingredientsText: string | null;
    }
    export function evaluateUniversalFlags(
      input: UniversalFlagInput,
    ): ScanFlag[];
    ```

- [ ] **Step 1: Write the failing test**

```ts
// server/services/__tests__/universal-flags.test.ts
import { describe, it, expect } from "vitest";
import {
  evaluateUniversalFlags,
  type UniversalFlagInput,
} from "../universal-flags";

const base: UniversalFlagInput = {
  per100g: {},
  categoriesTags: [],
  additivesTags: [],
  ingredientsText: null,
};
const ids = (fl: { id: string }[]) => fl.map((f) => f.id);

describe("evaluateUniversalFlags — FSA nutrient flags", () => {
  it("flags high sugar for a solid over the FSA food red line (>22.5 g/100g)", () => {
    const flags = evaluateUniversalFlags({ ...base, per100g: { sugar: 30 } });
    expect(ids(flags)).toContain("nutrient:sugar");
    expect(flags[0].tier).toBe("nutrition");
    expect(flags[0].kind).toBe("nutrient");
  });
  it("does NOT flag a solid at 12 g sugar/100g", () => {
    expect(
      ids(evaluateUniversalFlags({ ...base, per100g: { sugar: 12 } })),
    ).not.toContain("nutrient:sugar");
  });
  it("uses the lower BEVERAGE line: 12 g sugar/100ml flags for a drink", () => {
    const flags = evaluateUniversalFlags({
      ...base,
      per100g: { sugar: 12 },
      categoriesTags: ["en:beverages", "en:sodas"],
    });
    expect(ids(flags)).toContain("nutrient:sugar");
  });
  it("flags high sodium via the mg threshold (>600 mg/100g food), single conversion", () => {
    expect(
      ids(evaluateUniversalFlags({ ...base, per100g: { sodium: 700 } })),
    ).toContain("nutrient:sodium");
  });
  it("flags high saturated fat for a solid over 5 g/100g", () => {
    expect(
      ids(evaluateUniversalFlags({ ...base, per100g: { saturatedFat: 6 } })),
    ).toContain("nutrient:saturated_fat");
  });
  it("emits no nutrient flags when the nutrients are absent (fail-safe)", () => {
    expect(evaluateUniversalFlags(base)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/services/__tests__/universal-flags.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the rules + evaluator**

```ts
// server/services/nutrition-flag-rules.ts
export const FSA_FOOD = { sugar: 22.5, saturatedFat: 5.0, sodium: 600 }; // per 100 g; sodium mg
export const FSA_DRINK = { sugar: 11.25, saturatedFat: 2.5, sodium: 300 }; // per 100 ml; sodium mg
export const FSA_PORTION = { sugar: 27, saturatedFat: 6, sodium: 720 }; // per portion >100 g/ml; sodium mg
export const CAFFEINE_HIGH_MG = 150;
export const BEVERAGE_PARENT = "en:beverages";
export const CAFFEINE_CATEGORY_TAGS = [
  "en:energy-drinks",
  "en:coffees",
  "en:colas",
  "en:teas",
  "en:energy-shots",
];
export const CAFFEINE_INGREDIENT_RE =
  /caffeine|caféine|cafeina|cafeína|koffein|guaraná|guarana/i;
// Artificial (non-natural, non-polyol) sweeteners. Excludes E960 stevia, sugar alcohols.
export const ARTIFICIAL_SWEETENER_ETAGS = new Set([
  "en:e950",
  "en:e951",
  "en:e952",
  "en:e954",
  "en:e955",
  "en:e961",
  "en:e962",
  "en:e969",
]);
/** Beverage iff the en:beverages PARENT is present (tolerates polluted leaf tags). */
export function isBeverageCategory(tags: string[]): boolean {
  return tags.includes(BEVERAGE_PARENT);
}
```

```ts
// server/services/universal-flags.ts
import type { ScanFlag } from "@shared/types/scan-flags";
import {
  FSA_FOOD,
  FSA_DRINK,
  FSA_PORTION,
  isBeverageCategory,
} from "./nutrition-flag-rules";

export interface UniversalNutrients {
  sugar?: number;
  saturatedFat?: number;
  sodium?: number;
  caffeine?: number;
}
export interface UniversalFlagInput {
  per100g: UniversalNutrients;
  perServing?: UniversalNutrients;
  servingGrams?: number;
  categoriesTags: string[];
  novaGroup?: number;
  nutriScore?: string;
  additivesTags: string[];
  ingredientsText: string | null;
}

const NUTRIENT_META = {
  sugar: {
    title: "High in sugar",
    detail: "Above the FSA guideline for sugar.",
  },
  saturated_fat: {
    title: "High in saturated fat",
    detail: "Above the FSA guideline for saturated fat.",
  },
  sodium: {
    title: "High in sodium",
    detail: "Above the FSA guideline for salt.",
  },
} as const;

function high(
  per100g: number | undefined,
  perServing: number | undefined,
  servingGrams: number | undefined,
  per100Line: number,
  portionLine: number,
): boolean {
  if (per100g !== undefined && per100g > per100Line) return true;
  if (
    perServing !== undefined &&
    (servingGrams ?? 0) > 100 &&
    perServing > portionLine
  )
    return true;
  return false;
}

export function evaluateUniversalFlags(input: UniversalFlagInput): ScanFlag[] {
  const flags: ScanFlag[] = [];
  const drink = isBeverageCategory(input.categoriesTags);
  const per100 = drink ? FSA_DRINK : FSA_FOOD;
  const s = input.per100g,
    sv = input.perServing;

  const nutrientFlag = (
    key: keyof typeof NUTRIENT_META,
    nk: "sugar" | "saturated_fat" | "sodium",
    p100?: number,
    pServ?: number,
    line?: number,
    portion?: number,
  ) => {
    if (high(p100, pServ, input.servingGrams, line!, portion!)) {
      flags.push({
        id: `nutrient:${nk}`,
        kind: "nutrient",
        severity: "warn",
        tier: "nutrition",
        title: NUTRIENT_META[key].title,
        detail: NUTRIENT_META[key].detail,
        nutrient: nk,
      });
    }
  };
  nutrientFlag(
    "sugar",
    "sugar",
    s.sugar,
    sv?.sugar,
    per100.sugar,
    FSA_PORTION.sugar,
  );
  nutrientFlag(
    "saturated_fat",
    "saturated_fat",
    s.saturatedFat,
    sv?.saturatedFat,
    per100.saturatedFat,
    FSA_PORTION.saturatedFat,
  );
  nutrientFlag(
    "sodium",
    "sodium",
    s.sodium,
    sv?.sodium,
    per100.sodium,
    FSA_PORTION.sodium,
  );
  return flags;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/services/__tests__/universal-flags.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add server/services/nutrition-flag-rules.ts server/services/universal-flags.ts server/services/__tests__/universal-flags.test.ts
git commit -m "feat(scan): FSA high-sugar/sat-fat/sodium universal flags (food + beverage thresholds)"
```

---

## Task 6: Ultra-processed (NOVA-4) flag

**Files:**

- Modify: `server/services/universal-flags.ts`
- Test: `server/services/__tests__/universal-flags.test.ts`

**Interfaces:**

- Consumes: `input.novaGroup`.
- Produces: a `processing` flag with `id: "processing:ultra"` when `novaGroup === 4`.

- [ ] **Step 1: Write the failing test**

```ts
describe("evaluateUniversalFlags — NOVA", () => {
  it("flags ultra-processed for NOVA 4", () => {
    const flags = evaluateUniversalFlags({ ...base, novaGroup: 4 });
    const f = flags.find((x) => x.id === "processing:ultra");
    expect(f).toBeDefined();
    expect(f?.kind).toBe("processing");
    expect(f?.severity).toBe("warn");
    expect(f?.tier).toBe("nutrition");
  });
  it("does NOT flag NOVA 3 in v1", () => {
    expect(
      evaluateUniversalFlags({ ...base, novaGroup: 3 }).map((x) => x.id),
    ).not.toContain("processing:ultra");
  });
  it("does NOT flag when nova is absent", () => {
    expect(evaluateUniversalFlags(base).map((x) => x.id)).not.toContain(
      "processing:ultra",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/services/__tests__/universal-flags.test.ts -t "NOVA"`
Expected: FAIL — no such flag.

- [ ] **Step 3: Implement** — before `return flags;`:

```ts
if (input.novaGroup === 4) {
  flags.push({
    id: "processing:ultra",
    kind: "processing",
    severity: "warn",
    tier: "nutrition",
    title: "Ultra-processed",
    detail: "NOVA group 4 — made largely from industrial ingredients.",
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/services/__tests__/universal-flags.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/services/universal-flags.ts server/services/__tests__/universal-flags.test.ts
git commit -m "feat(scan): ultra-processed (NOVA-4) universal flag"
```

---

## Task 7: Caffeine ladder (High mg → Contains → none)

**Files:**

- Modify: `server/services/universal-flags.ts`
- Test: `server/services/__tests__/universal-flags.test.ts`

**Interfaces:**

- Consumes: `input.perServing?.caffeine` (mg, trusted serving), `input.per100g.caffeine`, `input.ingredientsText`, `input.categoriesTags`.
- Produces: `id: "nutrient:caffeine"` — `warn` + `value:{amount,unit:"mg"}` when a **trusted per-serving** mg ≥ 150; else `info` "Contains caffeine" when any presence signal; else nothing.

- [ ] **Step 1: Write the failing test**

```ts
describe("evaluateUniversalFlags — caffeine ladder", () => {
  it("HIGH with mg when a trusted serving is >=150mg", () => {
    const f = evaluateUniversalFlags({
      ...base,
      perServing: { caffeine: 160 },
    }).find((x) => x.id === "nutrient:caffeine");
    expect(f?.severity).toBe("warn");
    expect(f?.title).toContain("High in caffeine");
    expect(f?.value).toEqual({ amount: 160, unit: "mg" });
  });
  it("CONTAINS (info, no mg) when serving mg is present but <150", () => {
    const f = evaluateUniversalFlags({
      ...base,
      perServing: { caffeine: 34 },
    }).find((x) => x.id === "nutrient:caffeine");
    expect(f?.severity).toBe("info");
    expect(f?.title).toBe("Contains caffeine");
    expect(f?.value).toBeUndefined();
  });
  it("CONTAINS via multilingual ingredient text when no mg (German 'Koffein')", () => {
    const f = evaluateUniversalFlags({
      ...base,
      ingredientsText: "Wasser, Zucker, Koffein",
    }).find((x) => x.id === "nutrient:caffeine");
    expect(f?.severity).toBe("info");
  });
  it("CONTAINS via category when no mg and no ingredient match", () => {
    const f = evaluateUniversalFlags({
      ...base,
      categoriesTags: ["en:beverages", "en:energy-drinks"],
    }).find((x) => x.id === "nutrient:caffeine");
    expect(f?.severity).toBe("info");
  });
  it("NO flag with no mg and no signal (untrusted serving fails safe to nothing here)", () => {
    expect(evaluateUniversalFlags(base).map((x) => x.id)).not.toContain(
      "nutrient:caffeine",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/services/__tests__/universal-flags.test.ts -t "caffeine ladder"`
Expected: FAIL.

- [ ] **Step 3: Implement** — before `return flags;`, add (mg comes ONLY from the trusted per-serving value, per the serving-basis watch-item; per-100g caffeine alone is a presence signal, not a High assertion):

```ts
import {
  CAFFEINE_HIGH_MG,
  CAFFEINE_CATEGORY_TAGS,
  CAFFEINE_INGREDIENT_RE,
} from "./nutrition-flag-rules";
// ...
const servingMg = input.perServing?.caffeine;
const hasCaffeineSignal =
  servingMg !== undefined ||
  input.per100g.caffeine !== undefined ||
  (input.ingredientsText != null &&
    CAFFEINE_INGREDIENT_RE.test(input.ingredientsText)) ||
  input.categoriesTags.some((t) => CAFFEINE_CATEGORY_TAGS.includes(t));

if (servingMg !== undefined && servingMg >= CAFFEINE_HIGH_MG) {
  flags.push({
    id: "nutrient:caffeine",
    kind: "nutrient",
    severity: "warn",
    tier: "nutrition",
    nutrient: "caffeine",
    title: `High in caffeine`,
    detail: "Contains a high dose of caffeine.",
    value: { amount: Math.round(servingMg), unit: "mg" },
  });
} else if (hasCaffeineSignal) {
  flags.push({
    id: "nutrient:caffeine",
    kind: "nutrient",
    severity: "info",
    tier: "nutrition",
    nutrient: "caffeine",
    title: "Contains caffeine",
    detail: "This product contains caffeine.",
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/services/__tests__/universal-flags.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/services/universal-flags.ts server/services/__tests__/universal-flags.test.ts
git commit -m "feat(scan): caffeine ladder — High(mg) / Contains(presence) / none, multilingual"
```

---

## Task 8: Artificial-sweetener flag + Nutri-Score grade flag

**Files:**

- Modify: `server/services/universal-flags.ts`
- Test: `server/services/__tests__/universal-flags.test.ts`

**Interfaces:**

- Consumes: `input.additivesTags`, `input.nutriScore`.
- Produces: `id: "sweetener:artificial"` (`info`) when any additive ∈ `ARTIFICIAL_SWEETENER_ETAGS`; `id: "nutriscore:<grade>"` (`kind:"nutriscore"`, `info`, `grade`) when `nutriScore` ∈ a–e.

- [ ] **Step 1: Write the failing test**

```ts
describe("evaluateUniversalFlags — sweeteners & nutriscore", () => {
  it("flags artificial sweeteners for aspartame (E951)", () => {
    const f = evaluateUniversalFlags({
      ...base,
      additivesTags: ["en:e951", "en:e150d"],
    }).find((x) => x.id === "sweetener:artificial");
    expect(f?.kind).toBe("sweetener");
    expect(f?.title).toBe("Contains artificial sweeteners");
  });
  it("does NOT flag natural stevia (E960) or caramel color (E150d)", () => {
    expect(
      evaluateUniversalFlags({
        ...base,
        additivesTags: ["en:e960", "en:e150d"],
      }).map((x) => x.id),
    ).not.toContain("sweetener:artificial");
  });
  it("emits a nutriscore grade flag carrying the grade", () => {
    const f = evaluateUniversalFlags({ ...base, nutriScore: "e" }).find(
      (x) => x.kind === "nutriscore",
    );
    expect(f?.id).toBe("nutriscore:e");
    expect(f?.grade).toBe("e");
  });
  it("ignores an unknown nutriscore value", () => {
    expect(
      evaluateUniversalFlags({ ...base, nutriScore: "unknown" }).some(
        (x) => x.kind === "nutriscore",
      ),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/services/__tests__/universal-flags.test.ts -t "sweeteners & nutriscore"`
Expected: FAIL.

- [ ] **Step 3: Implement** — before `return flags;`:

```ts
import { ARTIFICIAL_SWEETENER_ETAGS } from "./nutrition-flag-rules";
// ...
if (input.additivesTags.some((t) => ARTIFICIAL_SWEETENER_ETAGS.has(t))) {
  flags.push({
    id: "sweetener:artificial",
    kind: "sweetener",
    severity: "info",
    tier: "nutrition",
    title: "Contains artificial sweeteners",
    detail: "Sweetened with one or more artificial sweeteners.",
  });
}
const grade = input.nutriScore;
if (grade && ["a", "b", "c", "d", "e"].includes(grade)) {
  flags.push({
    id: `nutriscore:${grade}`,
    kind: "nutriscore",
    severity: "info",
    tier: "nutrition",
    title: `Nutri-Score ${grade.toUpperCase()}`,
    grade: grade as "a" | "b" | "c" | "d" | "e",
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/services/__tests__/universal-flags.test.ts`
Expected: PASS (full file).

- [ ] **Step 5: Commit**

```bash
git add server/services/universal-flags.ts server/services/__tests__/universal-flags.test.ts
git commit -m "feat(scan): artificial-sweetener flag + Nutri-Score grade flag"
```

---

## Task 9: Wire universal flags into the barcode route

**Files:**

- Modify: `server/routes/nutrition.ts:107-153`
- Test: `server/routes/__tests__/nutrition.test.ts` (or the existing barcode-route test file — match the project's route-test location)

**Interfaces:**

- Consumes: `evaluateUniversalFlags`, the enriched `BarcodeLookupResult`.
- Produces: response `flags[]` = ordered `[...allergenFlags, ...universalFlags]`; response carries `novaGroup`, `nutriScore` and the new per100g/perServing nutrients; raw OFF content (`additivesTags`, `categoriesTags`, plus the Phase-1 `ingredientsText`/`allergenTags`) is stripped from the body.

- [ ] **Step 1: Write the failing test** (mirror the existing barcode-route test harness — mock `lookupBarcode` to return an enriched result)

```ts
it("attaches universal flags and strips raw OFF content", async () => {
  mockLookupBarcode.mockResolvedValue({
    productName: "Monster",
    barcode: "070847811169",
    source: "off",
    per100g: { sugar: 11.4, caffeine: 34 },
    perServing: { sugar: 13, caffeine: 160 },
    servingInfo: { displayLabel: "1 can", grams: 473, wasCorrected: false },
    isServingDataTrusted: true,
    allergenDataAvailable: false,
    novaGroup: 4,
    nutriScore: "e",
    additivesTags: ["en:e951"],
    categoriesTags: ["en:beverages"],
  });
  const res = await request(app)
    .get("/api/nutrition/barcode/070847811169")
    .set(authHeader);
  const ids = res.body.flags.map((f: any) => f.id);
  expect(ids).toEqual(
    expect.arrayContaining([
      "processing:ultra",
      "nutrient:caffeine",
      "sweetener:artificial",
      "nutriscore:e",
    ]),
  );
  expect(res.body.novaGroup).toBe(4);
  expect(res.body.additivesTags).toBeUndefined(); // stripped
  expect(res.body.categoriesTags).toBeUndefined(); // stripped
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/routes/__tests__/nutrition.test.ts -t "attaches universal flags"`
Expected: FAIL.

- [ ] **Step 3: Implement** — in the handler, after the Phase-1 `buildScanResponseFlags(...)` call:

```ts
const universalFlags = evaluateUniversalFlags({
  per100g: {
    sugar: result.per100g.sugar,
    saturatedFat: result.per100g.saturatedFat,
    sodium: result.per100g.sodium,
    caffeine: result.per100g.caffeine,
  },
  perServing: result.isServingDataTrusted
    ? {
        sugar: result.perServing.sugar,
        saturatedFat: result.perServing.saturatedFat,
        sodium: result.perServing.sodium,
        caffeine: result.perServing.caffeine,
      }
    : undefined,
  servingGrams: result.servingInfo.grams,
  categoriesTags: result.categoriesTags ?? [],
  novaGroup: result.novaGroup,
  nutriScore: result.nutriScore,
  additivesTags: result.additivesTags ?? [],
  ingredientsText: result.ingredientsText ?? null,
});
const orderedFlags = [...flags, ...universalFlags]; // allergen (Phase 1) first, then universal
```

Extend the destructure that strips OFF content to also drop `additivesTags` and `categoriesTags` (keep `novaGroup`/`nutriScore` — they are displayed):

```ts
const {
  ingredientsText: _i,
  allergenTags: _a,
  allergenDataAvailable: _d,
  additivesTags: _add,
  categoriesTags: _cat,
  ...clientResult
} = result;
void _i;
void _a;
void _d;
void _add;
void _cat;
res.json({ ...clientResult, flags: orderedFlags });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/routes/__tests__/nutrition.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/routes/nutrition.ts server/routes/__tests__/nutrition.test.ts
git commit -m "feat(scan): attach universal flags on barcode route; strip raw OFF content (ODbL)"
```

---

## Task 10: Client data plumbing (scaled nutrients + populate)

**Files:**

- Modify: `client/lib/serving-size-utils.ts` (`NutritionPer100g` ~34-42, `ValidatedNutrition` ~44-53, the scale function)
- Modify: `client/hooks/useNutritionLookup.ts` (`NutritionData` 39-53; response mapping ~214-258)
- Test: `client/lib/__tests__/serving-size-utils.test.ts`

**Interfaces:**

- Produces: `NutritionData`/`NutritionPer100g`/`ValidatedNutrition` gain `saturatedFat?`, `transFat?`, `cholesterol?`, `caffeine?`; plus `NutritionData` gains product-level `novaGroup?: number`, `nutriScore?: string`. The hook populates them from the barcode response and threads server `flags` (already wired).

- [ ] **Step 1: Write the failing test**

```ts
// serving-size-utils.test.ts
it("scales the new nutrients with serving quantity", () => {
  const scaled = scaleNutrition(
    { calories: 100, saturatedFat: 2, caffeine: 32 } as any,
    2,
  );
  expect(scaled.saturatedFat).toBe(4);
  expect(scaled.caffeine).toBe(64);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run client/lib/__tests__/serving-size-utils.test.ts -t "scales the new nutrients"`
Expected: FAIL — fields dropped.

- [ ] **Step 3: Implement** — add the four nutrient fields to `NutritionPer100g` and `ValidatedNutrition`, and to the object built by the scale function (mirror the existing `fiber`/`sugar`/`sodium` handling). In `useNutritionLookup.ts`, add `saturatedFat?/transFat?/cholesterol?/caffeine?/novaGroup?/nutriScore?` to `NutritionData` and copy them from the response where `per100g`/top-level fields are read (~214-258). `novaGroup`/`nutriScore` are product-level (not scaled).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run client/lib/__tests__/serving-size-utils.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/lib/serving-size-utils.ts client/hooks/useNutritionLookup.ts client/lib/__tests__/serving-size-utils.test.ts
git commit -m "feat(scan): thread saturatedFat/caffeine/nova/nutriScore to the client model"
```

---

## Task 11: New nutrient rows on NutritionDetailScreen

**Files:**

- Modify: `client/screens/NutritionDetailScreen.tsx` (Additional Nutrients card, 542-599)
- Test: co-located render test (match the screen's existing test file / `renderComponent` harness)

**Interfaces:**

- Consumes: `nutrition.saturatedFat/transFat/cholesterol/caffeine`.
- Produces: extra rows in the Additional Nutrients card, each rendered only when defined (unit: g for fats, mg for cholesterol/caffeine).

- [ ] **Step 1: Write the failing test**

```ts
it("renders a saturated fat row and a caffeine row when present", () => {
  const { queryByText } = renderComponent(<NutritionDetailScreen /* nav props + mocked hook */ />);
  expect(queryByText("Saturated Fat")).toBeTruthy();
  expect(queryByText("Caffeine")).toBeTruthy();
});
```

(Use the project's `renderComponent` from `test/utils/render-component` and the existing pattern for mocking `useNutritionLookup` — do not use `@testing-library/react-native` directly.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run client/screens/__tests__/NutritionDetailScreen.test.tsx -t "renders a saturated fat row"`
Expected: FAIL — rows absent.

- [ ] **Step 3: Implement** — extend the card's render guard to include the new fields, and add rows mirroring the Fiber/Sugar/Sodium rows (568-596):

```tsx
{
  nutrition?.saturatedFat !== undefined ? (
    <View style={[styles.nutrientRow, { borderTopColor: theme.border }]}>
      <ThemedText type="body" style={styles.nutrientLabel}>
        Saturated Fat
      </ThemedText>
      <ThemedText type="body" style={{ fontWeight: "600" }}>
        {roundToOneDecimal(nutrition.saturatedFat)} g
      </ThemedText>
    </View>
  ) : null;
}
{
  /* transFat (g), cholesterol (mg), caffeine (mg) — same pattern */
}
```

Add the new fields to the section's top-level `!== undefined` guard so the card shows when only a new nutrient is present.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run client/screens/__tests__/NutritionDetailScreen.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/screens/NutritionDetailScreen.tsx client/screens/__tests__/NutritionDetailScreen.test.tsx
git commit -m "feat(scan): show saturated fat / trans fat / cholesterol / caffeine rows"
```

---

## Task 12: Nutri-Score chip (contrast-tested A–E palette)

**Files:**

- Create: `client/components/nutri-score-chip-utils.ts`, `client/components/NutriScoreChip.tsx`
- Test: `client/components/__tests__/nutri-score-chip-contrast.test.ts` (mirror `badge-contrast.test.ts`)

**Interfaces:**

- Produces: `getNutriScoreVisuals(grade): { bg: string; fg: string; label: string }` sourced from theme tokens; `<NutriScoreChip grade={"a"|..|"e"} />`.

- [ ] **Step 1: Write the failing contrast test** (mirror the existing `badge-contrast.test.ts` — reuse its `contrastRatio` helper)

```ts
import { getNutriScoreVisuals } from "../nutri-score-chip-utils";
import { lightTheme, darkTheme } from "@/constants/theme";
import { contrastRatio } from "./contrast-helpers"; // the helper badge-contrast.test.ts uses

describe("NutriScore chip contrast (WCAG AA)", () => {
  for (const grade of ["a", "b", "c", "d", "e"] as const) {
    for (const theme of [lightTheme, darkTheme]) {
      it(`grade ${grade} fg/bg >= 4.5:1`, () => {
        const v = getNutriScoreVisuals(grade, theme);
        expect(contrastRatio(v.fg, v.bg)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run client/components/__tests__/nutri-score-chip-contrast.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement** — map A–E to existing theme semantic tokens that already pass AA (green→success, red→error, amber→warning), rather than raw hex. Keep `getNutriScoreVisuals(grade, theme)` pure; `NutriScoreChip` renders `{label}` with `accessibilityLabel={"Nutri-Score " + grade.toUpperCase()}`. If no existing token pair meets 4.5:1 for a grade in a theme, choose the nearest token that does — do not hand-pick unverified hex.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run client/components/__tests__/nutri-score-chip-contrast.test.ts`
Expected: PASS (10 cases).

- [ ] **Step 5: Commit**

```bash
git add client/components/nutri-score-chip-utils.ts client/components/NutriScoreChip.tsx client/components/__tests__/nutri-score-chip-contrast.test.ts
git commit -m "feat(scan): Nutri-Score grade chip with WCAG-AA A–E palette"
```

---

## Task 13: Partition flags into "For you" / "Heads up" + a11y grouping

**Files:**

- Modify: `client/screens/NutritionDetailScreen.tsx` (flags section 292-314)
- Create: `client/screens/nutrition-detail-flags-utils.ts` (pure partition + summary label)
- Test: `client/screens/__tests__/nutrition-detail-flags-utils.test.ts` + screen render test

**Interfaces:**

- Produces:
  - `partitionScanFlags(flags): { personal: ScanFlag[]; universal: ScanFlag[]; nutriScore?: ScanFlag }` — personal = `allergen`/`allergen-unavailable`; universal = `nutrient`/`processing`/`sweetener`, sorted danger→warn→info; `nutriScore` split out for the grade chip.
  - `headsUpSummaryLabel(universal): string` — e.g. "3 nutrition flags: high in sugar, high in caffeine, ultra-processed".

- [ ] **Step 1: Write the failing test**

```ts
import {
  partitionScanFlags,
  headsUpSummaryLabel,
} from "../nutrition-detail-flags-utils";
it("splits personal, universal (severity-sorted), and the nutriscore chip", () => {
  const flags = [
    {
      id: "nutriscore:e",
      kind: "nutriscore",
      severity: "info",
      tier: "nutrition",
      title: "Nutri-Score E",
      grade: "e",
    },
    {
      id: "nutrient:caffeine",
      kind: "nutrient",
      severity: "info",
      tier: "nutrition",
      title: "Contains caffeine",
    },
    {
      id: "processing:ultra",
      kind: "processing",
      severity: "warn",
      tier: "nutrition",
      title: "Ultra-processed",
    },
    {
      id: "allergen:peanuts",
      kind: "allergen",
      severity: "danger",
      tier: "safety",
      title: "Contains Peanuts",
    },
  ] as any;
  const p = partitionScanFlags(flags);
  expect(p.personal.map((f) => f.id)).toEqual(["allergen:peanuts"]);
  expect(p.universal.map((f) => f.id)).toEqual([
    "processing:ultra",
    "nutrient:caffeine",
  ]); // warn before info
  expect(p.nutriScore?.id).toBe("nutriscore:e");
  expect(headsUpSummaryLabel(p.universal)).toContain("Ultra-processed");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run client/screens/__tests__/nutrition-detail-flags-utils.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement** the pure utils, then update the screen: keep the existing block (292-314) as the **"For you"** section but feed it `partition.personal`; add a sibling **"Heads up"** `Animated.View` fed by `partition.universal` wrapped in one grouping view:

```tsx
{
  partition.universal.length > 0 || partition.nutriScore ? (
    <Animated.View style={styles.additionalNutrients} /* entering… */>
      <ThemedText type="h4" style={styles.sectionTitle}>
        Heads up
      </ThemedText>
      <View
        accessible={true}
        accessibilityLabel={headsUpSummaryLabel(partition.universal)}
        style={{ gap: Spacing.sm }}
      >
        {partition.universal.slice(0, 6).map((f) => (
          <ScanFlagBadge key={f.id} flag={f} />
        ))}
        {partition.nutriScore ? (
          <NutriScoreChip grade={partition.nutriScore.grade!} />
        ) : null}
      </View>
      <ThemedText
        type="caption"
        style={{ color: theme.textSecondary, marginTop: Spacing.xs }}
      >
        Informational only — not medical advice.
      </ThemedText>
    </Animated.View>
  ) : null;
}
```

Do **not** add any `announceForAccessibility` call here (Global Constraint — static content only). The `slice(0, 6)` is the defensive cap; a "+N more" affordance is only needed if `universal.length > 6` (realistically never — implement the count text but no navigation).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run client/screens/__tests__/nutrition-detail-flags-utils.test.ts client/screens/__tests__/NutritionDetailScreen.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/screens/NutritionDetailScreen.tsx client/screens/nutrition-detail-flags-utils.ts client/screens/__tests__/
git commit -m "feat(scan): split For-you (allergen) vs Heads-up (universal) flags with a11y grouping"
```

---

## Task 14 (optional, droppable): Universal flag on the scan-lock chip

**Files:**

- Modify: `client/camera/types/scan-phase.ts` (`ProductSummary.safetyFlag` → add `topFlag?`)
- Modify: `client/screens/ScanScreen.tsx` (`fetchProductInfo` ~293 — set `topFlag` via `pickTopFlag(data.flags)`)
- Test: existing ScanScreen/product-chip test

**Interfaces:**

- Consumes: server `flags[]`, `pickTopFlag` (Task 1).
- Produces: `ProductSummary.topFlag?: ScanFlag` (keep `safetyFlag` if other code reads it — LSP `findReferences` first).

- [ ] **Step 1: Write the failing test** — assert the chip shows the top flag (allergen still wins over a universal warn).
- [ ] **Step 2: Run red.**
- [ ] **Step 3:** Add `topFlag?: ScanFlag` to `ProductSummary`; in `fetchProductInfo`, set `topFlag: pickTopFlag(data.flags ?? [])`. Render it on the `ProductChip` where `safetyFlag` renders today. **LSP `findReferences` on `safetyFlag`** before renaming.
- [ ] **Step 4: Run green.**
- [ ] **Step 5: Commit** `feat(scan): surface top universal/allergen flag on the scan-lock chip`.

> If time-boxed, this task can be deferred to a follow-up without affecting the detail-screen deliverable — note the decision in the PR.

---

## Self-Review

**1. Spec coverage:**

- Enrichment (sat-fat/trans-fat/cholesterol/caffeine + NOVA/Nutri-Score/additives) → Tasks 2–4, 10–11. ✓
- FSA food + beverage thresholds, per-portion escalation, single sodium conversion → Task 5 (+ constants). ✓
- NOVA-4-only → Task 6. ✓ Caffeine ladder incl. multilingual + serving basis → Task 7. ✓ Sweeteners + Nutri-Score → Task 8. ✓
- Universal + free `"nutrition"` tier (never `"insight"`) → Task 1 + every flag push. ✓
- ODbL read-live-never-persist → Tasks 4, 9 (strip; no DB write). ✓
- Delivery via existing route overlay → Task 9. ✓
- "Heads up" vs "For you" partition + simultaneous-badge ordering + defensive cap → Task 13. ✓
- A11y: reuse tested tokens, Nutri-Score contrast test, grouping label, no `announceForAccessibility` → Tasks 12, 13 + Global Constraints. ✓
- Scan-lock chip → Task 14 (optional). ✓
- v2 (personal boost, caffeine personalization, screen convergence) → **out of scope, no tasks** (correct). ✓

**2. Placeholder scan:** No "TBD/handle edge cases" — each step carries real code or an explicit pattern-to-mirror with a file:line anchor. Two steps intentionally say "mirror the existing test harness" (route + client render) because inventing a parallel harness would violate the project's established test patterns; the behavior asserted is fully specified.

**3. Type consistency:** `ScanFlag`/`NutrientKind`/`pickTopFlag` (Task 1) are used unchanged in Tasks 5–9, 13–14. `BarcodePer100g` fields (Task 2) match the OFF mapping (Task 3), the route input (Task 9), and the client model (Task 10). `UniversalFlagInput` (Task 5) is the exact object the route builds (Task 9). Flag `id`s are stable across evaluator and client partition (`nutrient:sugar`, `processing:ultra`, `nutrient:caffeine`, `sweetener:artificial`, `nutriscore:<grade>`).

**Open verification for the implementer (not a gap — a house-methodology step):** confirm the live OFF keys `saturated-fat_100g`, `trans-fat_100g`, `cholesterol_100g`, `caffeine_100g`/`caffeine_serving`, `nova_group`, `nutriscore_grade`, `additives_tags`, `categories_tags` against a real payload before relying on any single one (the 2026-07-22 spike confirmed caffeine/NOVA/Nutri-Score/categories on 4 products; trans-fat/cholesterol unobserved — treat as best-effort optional).
